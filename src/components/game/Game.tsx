import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { BookOpen, Bot, ChevronsDown, Dices, FlaskConical, Pickaxe, Plane, Skull, Undo2, Zap } from "lucide-react";
import {
  COLS,
  DAMAGE_ROW,
  MAX_DAMAGE,
  MAX_ENERGY,
  MS_EFFECTS,
  RESEARCH,
  ROOMS,
  ROUTE,
  SKULL_ROW,
  SKY,
  TUNNELS,
  BASE_ROWS,
  type Room,
  type RoomKind,
} from "@/game/data";
import {
  canPlace,
  canPlaceRobot,
  discardDie,
  endRound,
  hasLegalPlacement,
  isExcavated,
  newGame,
  placeDie,
  placeRobot,
  reroll,
  resolvables,
  resolveDig,
  resolveRoom,
  roomContents,
  roomUsable,
  routeIndex,
  shipMove,
  skipRobots,
  startResolve,
  type GameState,
} from "@/game/engine";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Cell = [number, number];
const ROW_H = 22;
const SKY_ROWS = DAMAGE_ROW + 2; // start strip + 15 rows + city

const KIND: Record<RoomKind, { label: string; border: string; text: string; icons: ReactNode }> = {
  dig: { label: "Excavator", border: "border-muted-foreground/40", text: "text-muted-foreground", icons: <ChevronsDown className="size-3.5" /> },
  energy: { label: "Generator", border: "border-room-energy", text: "text-room-energy", icons: <Zap className="size-4" /> },
  robot: { label: "Robotics", border: "border-room-robot", text: "text-room-robot", icons: <Bot className="size-4" /> },
  fighter: { label: "Fighters", border: "border-room-fighter", text: "text-room-fighter", icons: <Plane className="size-4" /> },
  research: { label: "Lab", border: "border-room-research", text: "text-room-research", icons: <FlaskConical className="size-4" /> },
  energyFighter: {
    label: "Generator + Fighters",
    border: "border-room-fighter",
    text: "text-room-energy",
    icons: (
      <span className="flex gap-0.5">
        <Zap className="size-4" />
        <Plane className="size-4 text-room-fighter" />
      </span>
    ),
  },
};

function Pips({ value, className }: { value: number; className?: string }) {
  return <span className={cn("font-display text-lg font-bold leading-none", className)}>{value}</span>;
}

function DieFace({ value, color, small, className }: { value: number; color: "grey" | "white" | "robot"; small?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border-2 font-display font-bold",
        small ? "size-7 text-sm" : "size-11 text-xl",
        color === "grey" && "border-foreground/30 bg-die-grey text-foreground",
        color === "white" && "border-die-white bg-die-white text-background",
        color === "robot" && "border-room-robot bg-room-robot text-background",
        className,
      )}
    >
      {value}
    </span>
  );
}

function EnemyShip({ red, ghost }: { red?: boolean; ghost?: boolean }) {
  return (
    <svg viewBox="0 0 24 16" className={cn("h-4 w-6", red ? "text-threat" : "text-warn", ghost && "animate-ghost opacity-60")}>
      <path d="M2 3 L12 14 L22 3 L12 7 Z" fill="currentColor" stroke="currentColor" strokeWidth={ghost ? 0 : 1} style={{ filter: "drop-shadow(0 0 3px currentColor)" }} />
    </svg>
  );
}

function SkyGlyph({ r, c }: { r: number; c: number }) {
  const icon = SKY[r][c];
  if (!icon) return <span className="size-1 rounded-full bg-foreground/15" />;
  if (icon.t === "exp")
    return (
      <span className="flex size-[18px] items-center justify-center rounded-full bg-warn/25 text-[10px] font-bold text-warn shadow-[0_0_8px_var(--warn)]">
        {icon.v}+
      </span>
    );
  if (icon.t === "saucer")
    return (
      <svg viewBox="0 0 24 12" className="h-3 w-5 text-foreground">
        <ellipse cx="12" cy="8" rx="11" ry="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 7 Q12 0 17 7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  return (
    <span className={cn("text-sm font-bold leading-none", icon.t === "L" ? "text-threat" : "text-energy")}>
      {icon.t === "L" ? "◀" : "▶"}
    </span>
  );
}

function MsGlyph({ r }: { r: number }) {
  const e = MS_EFFECTS[r];
  if (!e) return null;
  const cls = "flex items-center gap-px text-[9px] font-bold";
  if (e.t === "skull") return <Skull className="size-3.5 text-foreground" />;
  if (e.t === "damage") return <span className={cn(cls, "text-threat")}>✸</span>;
  if (e.t === "red") return <span className={cn(cls, "text-threat")}>+<EnemyShip red /></span>;
  if (e.t === "exc") return <span className={cn(cls, "text-muted-foreground")}>-{e.n}<Pickaxe className="size-3" /></span>;
  return <span className={cn(cls, "text-research")}>-{e.n}<FlaskConical className="size-3" /></span>;
}

function Sky({ s, preview, focusCol }: { s: GameState; preview: GameState | null; focusCol: number | null }) {
  const ghosts = preview
    ? preview.ships.filter((p) => {
        const o = s.ships.find((x) => x.id === p.id)!;
        return p.pos !== null && (p.pos !== o.pos || p.col !== o.col);
      })
    : [];
  const shipStyle = (pos: number, col: number) => ({
    top: (pos + 1) * ROW_H + 3,
    left: `calc(${col * 20}% + 10% - 12px)`,
  });
  return (
    <section className="relative flex rounded-md border border-border sky-gradient" aria-label="Sky">
      <div className="relative w-8 shrink-0 border-r border-border/60" style={{ height: SKY_ROWS * ROW_H }}>
        {MS_EFFECTS.map((_, r) => (
          <div key={r} className="absolute inset-x-0 flex items-center justify-center" style={{ top: (r + 1) * ROW_H, height: ROW_H }}>
            <MsGlyph r={r} />
          </div>
        ))}
        <div
          className="absolute -right-1.5 z-20 text-research glow transition-all duration-700"
          style={{ top: (s.mothership + 1) * ROW_H + 2 }}
          title="Mothership effect resolved at end of round"
        >
          ▶
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden" style={{ height: SKY_ROWS * ROW_H }}>
        {focusCol !== null && (
          <div className="absolute inset-y-0 bg-energy/10 ring-1 ring-energy/50" style={{ left: `${focusCol * 20}%`, width: "20%" }} />
        )}
        {SKY.map((row, r) =>
          row.map((_, c) => (
            <div
              key={`${r}-${c}`}
              className="absolute flex items-center justify-center"
              style={{ top: (r + 1) * ROW_H, height: ROW_H, left: `${c * 20}%`, width: "20%" }}
            >
              <SkyGlyph r={r} c={c} />
            </div>
          )),
        )}
        <div className="absolute inset-x-0 flex items-center justify-around bg-threat/15" style={{ top: (DAMAGE_ROW + 1) * ROW_H, height: ROW_H }}>
          {Array.from({ length: COLS }, (_, c) => (
            <span key={c} className="text-threat glow">✸</span>
          ))}
        </div>
        <div className="absolute inset-x-0 top-0 z-10 rounded-b-[40%] mothership-hull transition-[height] duration-700 ease-out" style={{ height: (s.mothership + 1) * ROW_H }}>
          <div className="absolute inset-x-0 bottom-0 flex" style={{ height: ROW_H }}>
            {Array.from({ length: COLS }, (_, c) => (
              <div key={c} className="flex flex-1 items-center justify-center">
                <span className="size-3 border border-research/70" />
              </div>
            ))}
          </div>
        </div>
        {s.ships.map((sh) =>
          sh.pos === null ? null : (
            <div key={sh.id} className="absolute z-20 transition-all duration-500 ease-out" style={shipStyle(sh.pos, sh.col)}>
              <EnemyShip red={sh.color === "red"} />
            </div>
          ),
        )}
        {ghosts.map((sh) => (
          <div key={`g${sh.id}`} className="absolute z-20" style={shipStyle(sh.pos!, sh.col)}>
            <EnemyShip red={sh.color === "red"} ghost />
          </div>
        ))}
      </div>
    </section>
  );
}

function Base({
  s,
  selectable,
  onCell,
  onHover,
  pending,
  activeRooms,
}: {
  s: GameState;
  selectable: (c: Cell) => boolean;
  onCell: (c: Cell) => void;
  onHover: (c: Cell | null) => void;
  pending: Cell | null;
  activeRooms: Set<string>;
}) {
  const exc = ROUTE[s.excavator];
  const renderSlot = (cell: Cell, inRoom: boolean) => {
    const die = s.dice.find((d) => d.cell && d.cell[0] === cell[0] && d.cell[1] === cell[1]);
    const robot = s.robots.find((r) => r.cell[0] === cell[0] && r.cell[1] === cell[1]);
    const ok = selectable(cell);
    const isPending = pending && pending[0] === cell[0] && pending[1] === cell[1];
    const isExc = exc[0] === cell[0] && exc[1] === cell[1];
    const dug = isExcavated(s, cell);
    return (
      <button
        key={cell.join()}
        type="button"
        disabled={!ok}
        onClick={() => onCell(cell)}
        onPointerEnter={() => ok && onHover(cell)}
        onPointerLeave={() => onHover(null)}
        aria-label={`Space row ${cell[0] + 1} column ${cell[1] + 1}`}
        className={cn(
          "relative flex h-11 flex-1 items-center justify-center rounded-sm",
          !inRoom && "bg-background/70",
          !dug && "bg-[repeating-linear-gradient(45deg,transparent_0_4px,var(--border)_4px_5px)]",
          ok && "cursor-pointer ring-1 ring-energy/70 hover:bg-energy/15",
          isPending && "bg-energy/25 ring-2 ring-energy",
        )}
      >
        {die && !die.resolved && <DieFace small value={die.value} color={die.color} />}
        {die && die.resolved && die.cell![0] >= 0 && <DieFace small value={die.value} color={die.color} className="opacity-25" />}
        {robot && <DieFace small value={robot.value} color="robot" className={cn(robot.used && "rotate-45", robot.fresh && "opacity-70")} />}
        {isExc && !die && <Pickaxe className="size-5 text-foreground glow" />}
      </button>
    );
  };

  return (
    <section aria-label="Underground base" className="rounded-md border border-border bg-card/60 p-1.5">
      <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gridTemplateRows: `repeat(${BASE_ROWS}, auto)` }}>
        {ROOMS.map((r) => {
          const k = KIND[r.kind];
          const usable = roomUsable(s, r);
          const [row, c0] = r.cells[0];
          return (
            <div
              key={r.id}
              className={cn(
                "relative flex flex-col rounded-sm border-2 bg-secondary/60 transition-all",
                k.border,
                !usable && "border-dashed opacity-45",
                activeRooms.has(r.id) && "box-glow text-energy",
              )}
              style={{ gridRow: row + 1, gridColumn: `${c0 + 1} / span ${r.cells.length}` }}
            >
              <div className={cn("pointer-events-none absolute inset-x-0 top-0.5 flex items-center justify-between px-1", k.text)}>
                <span className="opacity-80">{k.icons}</span>
                {r.mod !== 0 && <span className="rounded-sm bg-background px-1 text-[10px] font-bold text-foreground">{r.mod > 0 ? `+${r.mod}` : r.mod}</span>}
              </div>
              <div className="flex gap-0.5 pt-1">{r.cells.map((cell) => renderSlot(cell, true))}</div>
              {r.cost > 0 && (
                <div className="pointer-events-none absolute -bottom-1.5 left-1/2 flex -translate-x-1/2 gap-px">
                  {Array.from({ length: r.cost }, (_, i) => (
                    <span key={i} className="flex size-3.5 items-center justify-center rounded-full bg-room-energy text-background">
                      <Zap className="size-2.5" />
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {TUNNELS.map((cell) => (
          <div key={cell.join()} className="flex rounded-sm bg-background/50" style={{ gridRow: cell[0] + 1, gridColumn: cell[1] + 1 }}>
            {renderSlot(cell, false)}
          </div>
        ))}
      </div>
    </section>
  );
}

function Header({ s }: { s: GameState }) {
  const active = s.ships.filter((x) => x.pos !== null && x.pos >= s.mothership).length;
  const closest = Math.max(-1, ...s.ships.filter((x) => x.pos !== null).map((x) => x.pos!));
  const threat = closest >= 11 ? "CRITICAL" : closest >= 7 ? "HIGH" : active > 0 ? "ELEVATED" : "LOW";
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 px-3 py-2 backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between">
        <h1 className="text-sm font-bold tracking-[0.2em] text-research glow">UNDER FALLING SKIES</h1>
        <span className="text-xs text-muted-foreground">RND {s.round}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-[10px] uppercase">
        <Stat label="Mothership" tone="text-research">
          {s.mothership}/{SKULL_ROW + 1}
        </Stat>
        <Stat label="Hull" tone="text-threat">
          <span className="flex gap-0.5">
            {Array.from({ length: MAX_DAMAGE }, (_, i) => (
              <span key={i} className={cn("h-2.5 w-1.5 rounded-[1px]", i < MAX_DAMAGE - s.damage ? "bg-research" : "bg-threat/30")} />
            ))}
          </span>
        </Stat>
        <Stat label="Energy" tone="text-energy">
          {s.energy}/{MAX_ENERGY}
        </Stat>
        <Stat label="Threat" tone={threat === "LOW" ? "text-research" : "text-threat"}>
          <span className="text-[11px]">{threat}</span>
        </Stat>
      </div>
      <div className="mt-1.5 flex items-center gap-0.5" aria-label="Research track">
        <FlaskConical className="mr-1 size-3 text-research" />
        {RESEARCH.slice(1).map((v, i) => (
          <span
            key={i}
            className={cn(
              "flex h-4 flex-1 items-center justify-center rounded-[2px] border text-[9px] transition-colors duration-500",
              i < s.research ? "border-research bg-research text-primary-foreground" : "border-border text-muted-foreground",
              i === RESEARCH.length - 2 && "border-research",
            )}
          >
            {v}
          </span>
        ))}
      </div>
    </header>
  );
}

function Stat({ label, tone, children }: { label: string; tone: string; children: ReactNode }) {
  return (
    <div className="rounded-sm border border-border bg-card/70 px-1.5 py-1">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("flex h-5 items-center font-display text-sm font-bold glow", tone)}>{children}</div>
    </div>
  );
}

function roomValue(s: GameState, r: Room) {
  const { dice, robots } = roomContents(s, r);
  return dice.reduce((a, d) => a + d.value, 0) + robots.reduce((a, b) => a + b.value, 0) + r.mod;
}

function RulesSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button type="button" className="flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <BookOpen className="size-3.5" /> Rules
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto border-border bg-card font-mono text-sm">
        <SheetHeader>
          <SheetTitle className="font-display text-research">Quick reference</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6 text-muted-foreground">
          <p><b className="text-foreground">1 · Place dice.</b> Roll 3 grey + 2 white. Place one at a time, max one die per column. Ships in that column descend by the die value. Placing a white die forces a reroll of the unplaced dice.</p>
          <p><b className="text-foreground">Sky icons.</b> ◀ ▶ shift the ship sideways if the space is free. Saucer: the mothership descends a row. Explosion N+: fighters with value ≥ N can shoot ships there. Reaching the city = 1 damage.</p>
          <p><b className="text-foreground">Excavator.</b> Top-row slots reduce ship movement by 1. One die per round may go on an undug space; at resolve, pay 1 energy and if the die ≥ distance, the excavator digs there.</p>
          <p><b className="text-foreground">2 · Resolve rooms</b> in any order. Pay the bolts shown. Value = sum of dice + modifier. Multi-space rooms need every space filled.</p>
          <ul className="list-inside list-disc space-y-1">
            <li><span className="text-room-energy">Generator</span>: +value energy (max 7).</li>
            <li><span className="text-room-fighter">Fighters</span>: shoot every ship on an explosion ≤ value.</li>
            <li><span className="text-room-research">Lab</span>: advance research while value covers the next spaces' sum.</li>
            <li><span className="text-room-robot">Robotics</span>: build a robot die (value) on any free room space. Usable from next round; −1 after each use.</li>
          </ul>
          <p><b className="text-foreground">3 · Mothership.</b> Resolve the effect beside the arrow, descend one row (ships in that row return), respawn ships into empty columns first.</p>
          <p><b className="text-foreground">End.</b> Win at the last research space. Lose if the mothership covers the skull or the hull takes 5 damage.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Game() {
  const [game, setGame] = useState<GameState | null>(null);
  useEffect(() => setGame(newGame()), []);
  if (!game) return <div className="flex min-h-screen items-center justify-center text-research glow">Booting bunker…</div>;
  return <GameView initial={game} />;
}

function GameView({ initial }: { initial: GameState }) {
  const [s, setS] = useState<GameState>(initial);
  const [history, setHistory] = useState<GameState[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [pending, setPending] = useState<Cell | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);

  const previewCell = pending ?? hover;
  const preview = useMemo(() => {
    if (sel === null || !previewCell || canPlace(s, sel, previewCell)) return null;
    return placeDie(s, sel, previewCell);
  }, [s, sel, previewCell]);

  const res = s.phase === "resolve" ? resolvables(s) : [];
  const activeRooms = new Set(res.map((r) => r.key));

  const selectable = (cell: Cell) => {
    if (s.phase === "place") return sel !== null && !canPlace(s, sel, cell);
    if (s.phase === "placeRobot") return canPlaceRobot(s, cell);
    return false;
  };

  const commit = (cell: Cell) => {
    if (sel === null) return;
    setHistory((h) => [...h, s]);
    const next = placeDie(s, sel, cell);
    setS(next);
    const nextDie = next.dice.find((d) => !d.cell);
    setSel(nextDie && !next.needsReroll ? nextDie.id : null);
    setPending(null);
    setHover(null);
  };

  const onCell = (cell: Cell) => {
    if (s.phase === "placeRobot") return setS(placeRobot(s, cell));
    if (pending && pending[0] === cell[0] && pending[1] === cell[1]) return commit(cell);
    setPending(cell);
  };

  const undo = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setS(prev);
    setHistory((h) => h.slice(0, -1));
    setPending(null);
    setSel(null);
  };

  const restart = () => {
    setS(newGame());
    setHistory([]);
    setSel(null);
    setPending(null);
  };

  const unplaced = s.dice.filter((d) => !d.cell);
  const selDie = s.dice.find((d) => d.id === sel);
  const stuck = selDie && !s.needsReroll && !hasLegalPlacement(s, selDie.id);
  const focusCol = previewCell && sel !== null ? previewCell[1] : null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col overflow-x-hidden">
      <Header s={s} />
      <main className="flex flex-1 flex-col gap-2 px-2 pb-56 pt-2">
        <Sky s={s} preview={preview} focusCol={focusCol} />
        <Base s={s} selectable={selectable} onCell={onCell} onHover={setHover} pending={pending} activeRooms={activeRooms} />
        <ol className="space-y-0.5 px-1 text-[11px] text-muted-foreground" aria-label="Game log">
          {s.log.slice(-4).map((l, i) => (
            <li key={`${s.log.length}-${i}`} className={cn(i === Math.min(3, s.log.length - 1) && "text-foreground")}>
              › {l}
            </li>
          ))}
        </ol>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-border bg-background/95 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 backdrop-blur">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {s.phase === "place" && (s.needsReroll ? "White die placed — reroll!" : pending ? "Tap again or confirm" : sel !== null ? "Tap a glowing space" : "Select a die")}
            {s.phase === "resolve" && "Resolve rooms"}
            {s.phase === "placeRobot" && `Place robot (${s.pendingRobotValue})`}
            {(s.phase === "won" || s.phase === "lost") && "Game over"}
          </span>
          <div className="flex gap-1.5">
            <RulesSheet />
            {s.phase === "place" && (
              <button type="button" onClick={undo} disabled={!history.length} className="flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-xs disabled:opacity-30">
                <Undo2 className="size-3.5" /> Undo
              </button>
            )}
          </div>
        </div>

        {s.phase === "place" && (
          <>
            <div className="flex justify-between gap-1.5" role="radiogroup" aria-label="Dice tray">
              {s.dice.map((d) => (
                <button
                  key={`${d.id}-${s.rollId}`}
                  type="button"
                  disabled={!!d.cell || s.needsReroll}
                  onClick={() => {
                    setSel(d.id);
                    setPending(null);
                  }}
                  aria-label={`${d.color} die ${d.value}`}
                  className={cn("rounded-md p-0.5 transition-all", sel === d.id && "-translate-y-1 ring-2 ring-energy box-glow text-energy", d.cell && "opacity-20")}
                >
                  <DieFace value={d.value} color={d.color} className={cn(!d.cell && "animate-dice-roll")} />
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              {s.needsReroll ? (
                <ActionBtn tone="warn" onClick={() => setS(reroll(s))}>
                  <Dices className="size-4" /> Reroll available dice
                </ActionBtn>
              ) : unplaced.length === 0 ? (
                <ActionBtn tone="primary" onClick={() => { setS(startResolve(s)); setHistory([]); }}>
                  End dice phase · Resolve rooms
                </ActionBtn>
              ) : pending && selDie ? (
                <ActionBtn tone="primary" onClick={() => commit(pending)}>
                  Place {selDie.value} · ships move {shipMove(s, selDie, pending)}
                </ActionBtn>
              ) : stuck ? (
                <ActionBtn tone="muted" onClick={() => { setS(discardDie(s, selDie.id)); setSel(null); }}>
                  No legal space — discard die
                </ActionBtn>
              ) : (
                <ActionBtn tone="muted" disabled>
                  {unplaced.length} dice left
                </ActionBtn>
              )}
            </div>
          </>
        )}

        {s.phase === "resolve" && (
          <div className="space-y-1.5">
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {res.length === 0 && <p className="text-xs text-muted-foreground">Nothing left to resolve.</p>}
              {res.map((x) => {
                if (x.dieId !== undefined) {
                  const d = s.dice.find((dd) => dd.id === x.dieId)!;
                  const dist = routeIndex(d.cell!) - s.excavator;
                  return (
                    <ResolveRow key={x.key} icon={<Pickaxe className="size-4" />} title={`Dig ${dist} · die ${d.value}`} cost={1} ok={d.value >= dist && s.energy >= 1}
                      onUse={() => setS(resolveDig(s, d.id, true))} onSkip={() => setS(resolveDig(s, d.id, false))} />
                  );
                }
                const r = x.room!;
                const c = roomContents(s, r);
                const v = roomValue(s, r);
                return (
                  <ResolveRow key={x.key} icon={<span className={KIND[r.kind].text}>{KIND[r.kind].icons}</span>}
                    title={`${KIND[r.kind].label} · value ${v}${c.full ? "" : " (incomplete)"}`} cost={r.cost} ok={c.full && s.energy >= r.cost && v > 0}
                    onUse={() => setS(resolveRoom(s, r.id, true))} onSkip={() => setS(skipRobots(s, r.id))} />
                );
              })}
            </div>
            <ActionBtn tone={res.length ? "muted" : "primary"} onClick={() => { setS(endRound(s)); setSel(null); }}>
              End round · Mothership descends
            </ActionBtn>
          </div>
        )}

        {s.phase === "placeRobot" && (
          <ActionBtn tone="muted" onClick={() => setS(placeRobot(s, null))}>Discard robot</ActionBtn>
        )}

        {(s.phase === "won" || s.phase === "lost") && (
          <div className="space-y-2 text-center">
            <p className={cn("font-display text-xl font-bold glow", s.phase === "won" ? "text-research" : "text-threat")}>
              {s.phase === "won" ? "VICTORY" : "BASE LOST"}
            </p>
            <p className="text-xs text-muted-foreground">{s.endReason}</p>
            <ActionBtn tone="primary" onClick={restart}>New game</ActionBtn>
          </div>
        )}
      </footer>
    </div>
  );
}

function ActionBtn({ tone, children, ...p }: { tone: "primary" | "warn" | "muted"; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...p}
      className={cn(
        "flex h-11 flex-1 items-center justify-center gap-2 rounded-sm border font-display text-xs font-bold uppercase tracking-wide transition-all disabled:opacity-40",
        tone === "primary" && "border-research bg-research/15 text-research box-glow",
        tone === "warn" && "animate-pulse border-warn bg-warn/20 text-warn box-glow",
        tone === "muted" && "border-border text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ResolveRow({ icon, title, cost, ok, onUse, onSkip }: { icon: ReactNode; title: string; cost: number; ok: boolean; onUse: () => void; onSkip: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-card/70 px-2 py-1">
      {icon}
      <span className="flex-1 truncate text-xs">{title}</span>
      {cost > 0 && <span className="text-[10px] text-room-energy">{cost}⚡</span>}
      <button type="button" onClick={onUse} disabled={!ok} className="rounded-sm border border-research px-2 py-0.5 text-xs text-research disabled:border-border disabled:text-muted-foreground">Use</button>
      <button type="button" onClick={onSkip} className="rounded-sm border border-border px-2 py-0.5 text-xs text-muted-foreground">Skip</button>
    </div>
  );
}
