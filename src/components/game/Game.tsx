import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { BookOpen, Bot, ChevronsDown, Dices, FlaskConical, Lock, Menu, Pickaxe, Plane, Skull, Undo2, Zap } from "lucide-react";
import { toast } from "sonner";
import { BASE_ROWS, COLS, DAMAGE_ROW, MAX_DAMAGE, MAX_ENERGY, type Difficulty, type MsEffect, type Room, type RoomPart } from "@/game/data";
import {
  board,
  canPlace,
  canPlaceRobot,
  digTargets,
  endRound,
  hasLegalPlacement,
  isExcavated,
  newGame,
  placeDie,
  placeRobot,
  replay,
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
  type Cell,
  type GameState,
} from "@/game/engine";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Placement = { dieId: number; cell: Cell };
const ROW_H = 22;
const CELL_H = 56;
const SKY_ROWS = DAMAGE_ROW + 2;
const key = (c: Cell) => `${c[0]},${c[1]}`;
const same = (a: Cell | null | undefined, b: Cell | null | undefined) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

const PART: Record<RoomPart, { label: string; border: string; text: string; Icon: typeof Zap }> = {
  dig: { label: "Excavator", border: "border-muted-foreground/40", text: "text-muted-foreground", Icon: ChevronsDown },
  energy: { label: "Generator", border: "border-room-energy", text: "text-room-energy", Icon: Zap },
  robot: { label: "Robotics", border: "border-room-robot", text: "text-room-robot", Icon: Bot },
  fighter: { label: "Fighters", border: "border-room-fighter", text: "text-room-fighter", Icon: Plane },
  research: { label: "Lab", border: "border-room-research", text: "text-room-research", Icon: FlaskConical },
};
const roomLabel = (r: Room) => r.parts.map((p) => PART[p].label).join(" + ");
const RoomIcons = ({ r, className }: { r: Room; className?: string }) => (
  <span className={cn("flex gap-0.5", className)}>
    {r.parts.map((p) => {
      const I = PART[p].Icon;
      return <I key={p} className={cn("size-4", PART[p].text)} />;
    })}
  </span>
);

/* ---------- dice ---------- */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 2], [2, 0]],
  3: [[0, 2], [1, 1], [2, 0]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};
type DieColor = "grey" | "white" | "robot";
function DieFace({ value, color, small, className }: { value: number; color: DieColor; small?: boolean; className?: string }) {
  return (
    <span
      aria-label={`${value}`}
      className={cn(
        "grid grid-cols-3 grid-rows-3 rounded-[22%] border-2 shadow-[inset_0_-3px_0_rgb(0_0_0/0.25),0_2px_4px_rgb(0_0_0/0.4)]",
        small ? "size-8 gap-px p-1" : "size-12 gap-0.5 p-1.5",
        color === "grey" && "border-foreground/30 bg-die-grey",
        color === "white" && "border-die-white bg-die-white",
        color === "robot" && "border-room-robot bg-room-robot",
        className,
      )}
    >
      {(PIPS[value] ?? []).map(([r, c], i) => (
        <span
          key={i}
          className={cn("rounded-full", color === "grey" ? "bg-foreground" : "bg-background")}
          style={{ gridRow: r + 1, gridColumn: c + 1 }}
        />
      ))}
    </span>
  );
}

/** Tumbles through random faces, then lands on the real value. */
function RollingDie({ value, color, delay = 0, className }: { value: number; color: DieColor; delay?: number; className?: string }) {
  const [shown, setShown] = useState(() => 1 + Math.floor(Math.random() * 6));
  const [rolling, setRolling] = useState(true);
  useEffect(() => {
    let n = 0;
    const frames = 7 + delay;
    const id = setInterval(() => {
      n++;
      if (n >= frames) {
        clearInterval(id);
        setShown(value);
        setRolling(false);
      } else setShown(1 + Math.floor(Math.random() * 6));
    }, 70);
    return () => clearInterval(id);
  }, [value, delay]);
  return <DieFace value={shown} color={color} className={cn(rolling ? "animate-dice-tumble" : "animate-dice-land", className)} />;
}

/* ---------- sky ---------- */
function EnemyShip({ red, ghost }: { red?: boolean; ghost?: boolean }) {
  return (
    <svg viewBox="0 0 24 16" className={cn("h-4 w-6", red ? "text-threat" : "text-warn", ghost && "animate-ghost opacity-60")}>
      <path d="M2 3 L12 14 L22 3 L12 7 Z" fill="currentColor" stroke="currentColor" strokeWidth={ghost ? 0 : 1} style={{ filter: "drop-shadow(0 0 3px currentColor)" }} />
    </svg>
  );
}

function SkyGlyph({ s, r, c }: { s: GameState; r: number; c: number }) {
  const icon = board(s).sky[r]![c];
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
  return <span className={cn("text-sm font-bold leading-none", icon.t === "L" ? "text-threat" : "text-energy")}>{icon.t === "L" ? "◀" : "▶"}</span>;
}

function MsGlyph({ e }: { e: MsEffect | undefined }) {
  if (!e) return null;
  const cls = "flex items-center gap-px text-[9px] font-bold";
  if (e.t === "skull") return <Skull className="size-3.5 text-foreground" />;
  if (e.t === "damage") return <span className={cn(cls, "text-threat")}>✸</span>;
  if (e.t === "red") return <span className={cn(cls, "text-threat")}>+<EnemyShip red /></span>;
  if (e.t === "exc") return <span className={cn(cls, "text-muted-foreground")}>-{e.n}<Pickaxe className="size-3" /></span>;
  return <span className={cn(cls, "text-research")}>-{e.n}<FlaskConical className="size-3" /></span>;
}

function Sky({ s, from, preview, focusCol }: { s: GameState; from: GameState; preview: GameState | null; focusCol: number | null }) {
  const b = board(s);
  const ghosts = preview
    ? preview.ships.filter((p) => {
        const o = from.ships.find((x) => x.id === p.id)!;
        return p.pos !== null && (p.pos !== o.pos || p.col !== o.col);
      })
    : [];
  const shipStyle = (pos: number, col: number) => ({ top: (pos + 1) * ROW_H + 3, left: `calc(${col * 20}% + 10% - 12px)` });
  return (
    <section className="relative flex rounded-md border border-border sky-gradient" aria-label="Sky">
      <div className="relative w-8 shrink-0 border-r border-border/60" style={{ height: SKY_ROWS * ROW_H }}>
        {b.msEffects.map((e, r) => (
          <div key={r} className="absolute inset-x-0 flex items-center justify-center" style={{ top: (r + 1) * ROW_H, height: ROW_H }}>
            <MsGlyph e={e} />
          </div>
        ))}
        <div className="absolute -right-1.5 z-20 text-research glow transition-all duration-700" style={{ top: (s.mothership + 1) * ROW_H + 2 }}>
          ▶
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden" style={{ height: SKY_ROWS * ROW_H }}>
        {focusCol !== null && <div className="absolute inset-y-0 bg-energy/10 ring-1 ring-energy/50" style={{ left: `${focusCol * 20}%`, width: "20%" }} />}
        {b.sky.map((row, r) =>
          row.map((_, c) => (
            <div key={`${r}-${c}`} className="absolute flex items-center justify-center" style={{ top: (r + 1) * ROW_H, height: ROW_H, left: `${c * 20}%`, width: "20%" }}>
              <SkyGlyph s={s} r={r} c={c} />
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

/* ---------- base ---------- */
const cellBox = (c: Cell, rows = 1, cols = 1) => ({
  left: `${c[1] * 20}%`,
  width: `${cols * 20}%`,
  top: c[0] * CELL_H,
  height: rows * CELL_H,
});

function Base({
  s,
  exc,
  digging,
  selectable,
  dimmed,
  reach,
  onCell,
  onHover,
  pending,
  activeRooms,
  movable,
  onDieDown,
  draggingId,
}: {
  s: GameState;
  exc: number;
  digging: boolean;
  selectable: (c: Cell) => boolean;
  dimmed: boolean;
  reach: number | null; // furthest route index the selected die can dig to
  onCell: (c: Cell) => void;
  onHover: (c: Cell | null) => void;
  pending: Cell | null;
  activeRooms: Set<string>;
  movable: (dieId: number) => boolean;
  onDieDown: (dieId: number, e: RPointerEvent) => void;
  draggingId: number | null;
}) {
  const b = board(s);
  const route = b.route;
  const inRoom = new Set(b.rooms.flatMap((r) => r.cells.map(key)));
  const emptyRoute = route.filter((c) => !inRoom.has(key(c)));
  const center = (c: Cell) => ({ x: `${(c[1] + 0.5) * 20}%`, y: (c[0] + 0.5) * CELL_H });
  const prevExc = useRef(exc);
  const justDug = useRef(new Set<string>());
  if (exc !== prevExc.current) {
    if (exc > prevExc.current) justDug.current = new Set(route.slice(prevExc.current + 1, exc + 1).map(key));
    prevExc.current = exc;
  }
  const slots: Cell[] = [...b.rooms.flatMap((r) => r.cells), ...emptyRoute];
  const excCell = route[exc]!;

  return (
    <section aria-label="Underground base" className="rounded-md border border-border bg-card/60 p-1.5">
      <div className="relative" style={{ height: BASE_ROWS * CELL_H }}>
        {/* dug tunnels (empty, on the route) */}
        {emptyRoute.map((c) =>
          isExcavated(s, c) ? (
            <div key={key(c)} className="absolute p-1" style={cellBox(c)}>
              <div className="h-full rounded-md bg-background/70 shadow-[inset_0_2px_6px_rgb(0_0_0/0.6)]" />
            </div>
          ) : null,
        )}
        {/* rooms */}
        {b.rooms.map((r) => {
          const rs = r.cells.map((c) => c[0]);
          const cs = r.cells.map((c) => c[1]);
          const r0 = Math.min(...rs);
          const c0 = Math.min(...cs);
          const usable = roomUsable(s, r);
          return (
            <div key={r.id} className="absolute p-0.5" style={cellBox([r0, c0], Math.max(...rs) - r0 + 1, Math.max(...cs) - c0 + 1)}>
              <div
                className={cn(
                  "relative flex h-full items-center justify-center rounded-sm border-2 bg-secondary/60 transition-all",
                  PART[r.parts[0]!].border,
                  r.parts[1] === "fighter" && "border-r-room-fighter border-b-room-fighter",
                  r.parts[1] === "robot" && "border-r-room-robot border-b-room-robot",
                  !usable && "border-dashed opacity-40",
                  activeRooms.has(r.id) && "box-glow text-energy",
                  dimmed && "opacity-50",
                )}
              >
                <RoomIcons r={r} className="pointer-events-none absolute left-1 top-0.5 opacity-70" />
                {r.mod !== 0 && <span className="absolute right-0.5 top-0.5 rounded-sm bg-background px-1 text-[10px] font-bold text-foreground">{r.mod > 0 ? `+${r.mod}` : r.mod}</span>}
                {r.cost > 0 && (
                  <div className="pointer-events-none absolute -bottom-1.5 left-1/2 z-10 flex -translate-x-1/2 gap-px">
                    {Array.from({ length: r.cost }, (_, i) => (
                      <span key={i} className="flex size-3.5 items-center justify-center rounded-full bg-room-energy text-background">
                        <Zap className="size-2.5" />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {/* excavator route */}
        <svg className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible" aria-hidden>
          {route.slice(1).map((c, j) => {
            const i = j + 1;
            const a = center(route[i - 1]!);
            const z = center(c);
            const dug = i <= exc;
            const reachable = reach !== null && i > exc && i <= reach;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={z.x}
                y2={z.y}
                strokeLinecap="round"
                strokeWidth={dug ? 3 : reachable ? 4 : 2}
                strokeDasharray={dug ? undefined : "4 4"}
                className={cn(
                  "transition-all duration-300",
                  dug ? "stroke-research/70" : reachable ? "animate-route stroke-energy" : "stroke-muted-foreground/50",
                  reach !== null && !dug && !reachable && "opacity-25",
                )}
                style={dug ? undefined : { filter: reachable ? "drop-shadow(0 0 3px var(--energy))" : undefined }}
              />
            );
          })}
        </svg>
        {/* distance labels on undug route spaces */}
        {route.map((c, i) => {
          if (i <= exc) return null;
          const reachable = reach !== null && i <= reach;
          return (
            <span
              key={`n${i}`}
              className={cn(
                "pointer-events-none absolute z-20 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[9px] font-bold transition-all",
                reachable ? "border-energy bg-energy text-background" : "border-muted-foreground/50 bg-background text-muted-foreground",
                reach !== null && !reachable && "opacity-30",
              )}
              style={{ left: center(c).x, top: c[0] * CELL_H + 11 }}
            >
              {i - exc}
            </span>
          );
        })}
        {/* slots */}
        {slots.map((cell) => {
          const die = s.dice.find((d) => same(d.cell, cell));
          const robot = s.robots.find((r) => same(r.cell, cell));
          const ok = selectable(cell);
          const isPending = same(pending, cell);
          const canMove = die && movable(die.id);
          return (
            <div key={key(cell)} className="absolute z-20 p-1.5" style={cellBox(cell)}>
              <div
                role="button"
                tabIndex={ok ? 0 : -1}
                aria-disabled={!ok}
                data-cell={key(cell)}
                onClick={() => ok && onCell(cell)}
                onPointerEnter={() => ok && onHover(cell)}
                onPointerLeave={() => onHover(null)}
                aria-label={`Space row ${cell[0] + 1} column ${cell[1] + 1}`}
                className={cn(
                  "flex h-full items-center justify-center rounded-sm transition-colors",
                  justDug.current.has(key(cell)) && "animate-dug",
                  ok && "cursor-pointer bg-energy/10 ring-2 ring-inset ring-energy/70 hover:bg-energy/25",
                  isPending && "bg-energy/30 ring-energy",
                )}
              >
                {die && die.cell![0] >= 0 && (
                  <span
                    onPointerDown={canMove ? (e) => onDieDown(die.id, e) : undefined}
                    className={cn("relative", canMove && "cursor-grab touch-none", draggingId === die.id && "opacity-30")}
                  >
                    <DieFace small value={die.value} color={die.color} className={cn("animate-dice-land", die.resolved && "opacity-25")} />
                    {!canMove && s.phase === "place" && <Lock className="absolute -right-1 -top-1 size-3 text-muted-foreground" />}
                  </span>
                )}
                {robot && <DieFace small value={robot.value} color="robot" className={cn(robot.used && "rotate-45", robot.fresh && "opacity-70")} />}
              </div>
            </div>
          );
        })}
        {/* excavator token */}
        <div
          className="pointer-events-none absolute z-30 transition-all duration-300 ease-linear"
          style={{ left: `calc(${excCell[1] * 20}% + 3px)`, top: excCell[0] * CELL_H + CELL_H - 23 }}
          aria-label="Excavator"
        >
          <span className="relative flex size-5 items-center justify-center rounded-full border border-research bg-background text-research box-glow">
            <Pickaxe className={cn("size-3.5", digging && "animate-dig")} />
            {digging && <span className="absolute inset-0 animate-ping rounded-full bg-warn/60" />}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ---------- header & menus ---------- */
function Header({ s, onNew }: { s: GameState; onNew: (d: Difficulty) => void }) {
  const b = board(s);
  const active = s.ships.filter((x) => x.pos !== null && x.pos >= s.mothership).length;
  const closest = Math.max(-1, ...s.ships.filter((x) => x.pos !== null).map((x) => x.pos!));
  const threat = closest >= 11 ? "CRITICAL" : closest >= 7 ? "HIGH" : active > 0 ? "ELEVATED" : "LOW";
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 px-3 py-2 backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h1 className="text-sm font-bold tracking-[0.2em] text-research glow">UNDER FALLING SKIES</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {s.difficulty.toUpperCase()} · RND {s.round}
          </span>
          <GameMenu current={s.difficulty} onNew={onNew} />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-[10px] uppercase">
        <Stat label="Mothership" tone="text-research">
          {s.mothership}/{b.skullRow + 1}
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
        {b.research.slice(1).map((v, i) => (
          <span
            key={i}
            className={cn(
              "flex h-4 flex-1 items-center justify-center rounded-[2px] border text-[9px] transition-colors duration-500",
              i < s.research ? "border-research bg-research text-primary-foreground" : "border-border text-muted-foreground",
              i === b.research.length - 2 && "border-research",
            )}
          >
            {v}
          </span>
        ))}
      </div>
    </header>
  );
}

function GameMenu({ current, onNew }: { current: Difficulty; onNew: (d: Difficulty) => void }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Difficulty>(current);
  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (o) setD(current); }}>
      <SheetTrigger asChild>
        <button type="button" aria-label="Menu" className="rounded-sm border border-border p-1 text-muted-foreground hover:text-foreground">
          <Menu className="size-4" />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="border-border bg-card font-mono">
        <SheetHeader>
          <SheetTitle className="font-display text-research">Menu</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Difficulty</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Difficulty">
            {(["easy", "hard"] as const).map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={d === x}
                onClick={() => setD(x)}
                className={cn("rounded-sm border px-3 py-2 text-left text-sm", d === x ? "border-research bg-research/15 text-research box-glow" : "border-border text-muted-foreground")}
              >
                <b className="font-display uppercase">{x}</b>
                <span className="block text-[11px] opacity-80">{x === "easy" ? "Easy side of every card" : "Star sides · red ships from the start"}</span>
              </button>
            ))}
          </div>
          <ActionBtn tone="primary" onClick={() => { onNew(d); setOpen(false); }}>
            Start new game
          </ActionBtn>
        </div>
      </SheetContent>
    </Sheet>
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
          <p><b className="text-foreground">1 · Place dice.</b> Roll 3 grey + 2 white. Tap or drag a die onto a space; max one die per column. Ships in that column descend by the die value. Placing a white die forces a reroll of the unplaced dice. Until you reroll, you can drag placed dice to other spaces or back to the tray.</p>
          <p><b className="text-foreground">Sky icons.</b> ◀ ▶ shift the ship sideways if the space is free. Saucer: the mothership descends a row. Explosion N+: fighters with value ≥ N can shoot ships there. Reaching the city = 1 damage.</p>
          <p><b className="text-foreground">Excavator.</b> Follow the dashed path; numbers show the distance. One die per round may go on an undug space no further than its value. At resolve, pay 1 energy to dig there.</p>
          <p><b className="text-foreground">2 · Resolve rooms</b> in any order. Pay the bolts shown. Value = sum of dice + modifier. Multi-space rooms need every space filled.</p>
          <ul className="list-inside list-disc space-y-1">
            <li><span className="text-room-energy">Generator</span>: +value energy (max 7).</li>
            <li><span className="text-room-fighter">Fighters</span>: shoot every ship on an explosion ≤ value.</li>
            <li><span className="text-room-research">Lab</span>: advance research while value covers the next spaces' sum.</li>
            <li><span className="text-room-robot">Robotics</span>: build a robot die (value) on any free room space. Usable from next round; −1 after each use.</li>
          </ul>
          <p><b className="text-foreground">3 · Mothership.</b> Resolve the effect beside the arrow, descend one row, respawn ships into empty columns first.</p>
          <p><b className="text-foreground">End.</b> Win at the last research space. Lose if the mothership covers the skull or the hull takes 5 damage.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- game ---------- */
export function Game() {
  const [game, setGame] = useState<{ s: GameState; n: number } | null>(null);
  // A game saved in the old format (e.g. after an update) gets replaced by a fresh one.
  useEffect(() => {
    if (game && !game.s) setGame({ s: newGame(), n: 1 });
  }, [game]);
  useEffect(() => {
    const d: Difficulty = localStorage.getItem("ufs-difficulty") === "hard" ? "hard" : "easy";
    setGame({ s: newGame(Math.random, d), n: 0 });
  }, []);
  if (!game?.s) return <div className="flex min-h-screen items-center justify-center text-research glow">Booting bunker…</div>;
  const onNew = (d: Difficulty) => {
    localStorage.setItem("ufs-difficulty", d);
    setGame((g) => ({ s: newGame(Math.random, d), n: (g?.n ?? 0) + 1 }));
  };
  return <GameView key={game.n} initial={game.s} onNew={onNew} />;
}

function GameView({ initial, onNew }: { initial: GameState; onNew: (d: Difficulty) => void }) {
  const [s, setS] = useState<GameState>(initial);
  const [lockBase, setLockBase] = useState<GameState>(initial);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [pending, setPending] = useState<Cell | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [drag, setDrag] = useState<{ dieId: number; x: number; y: number } | null>(null);
  const [exc, setExc] = useState(initial.excavator);

  // walk the excavator token one space at a time
  useEffect(() => {
    if (exc === s.excavator) return undefined;
    const t = setTimeout(() => setExc((e) => e + Math.sign(s.excavator - e)), 300);
    return () => clearTimeout(t);
  }, [exc, s.excavator]);

  const fresh = (next: GameState) => {
    setS(next);
    setLockBase(next);
    setPlacements([]);
  };

  const placedIds = new Set(placements.filter((p) => p.cell[0] >= 0).map((p) => p.dieId));
  const movable = (dieId: number) => s.phase === "place" && placedIds.has(dieId);

  /** State to evaluate a die against: without it (if it's being moved) and before any trailing white die. */
  const ctx = (dieId: number) => {
    if (!placedIds.has(dieId)) return { base: s as GameState | null, pre: placements, post: [] as Placement[] };
    let pre = placements.filter((p) => p.dieId !== dieId);
    let post: Placement[] = [];
    const last = pre.at(-1);
    if (last && s.dice.find((d) => d.id === last.dieId)?.color === "white") {
      post = [last];
      pre = pre.slice(0, -1);
    }
    return { base: replay(lockBase, pre), pre, post };
  };
  const legal = (dieId: number, cell: Cell) => {
    const b = ctx(dieId).base;
    return !!b && !canPlace(b, dieId, cell);
  };

  const selCtx = sel !== null ? ctx(sel) : null;
  const selBase = selCtx?.base ?? s;
  const previewCell = pending ?? hover;
  const preview = useMemo(() => {
    if (sel === null || !previewCell || !selCtx?.base || canPlace(selCtx.base, sel, previewCell)) return null;
    return placeDie(selCtx.base, sel, previewCell);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, sel, previewCell, placements]);

  const dig = s.phase === "place" && sel !== null && selCtx?.base ? digTargets(selCtx.base, sel) : [];
  const reach = s.phase === "place" && sel !== null ? (dig.length ? Math.max(...dig.map((c) => routeIndex(s, c))) : s.excavator) : null;

  const res = s.phase === "resolve" ? resolvables(s) : [];
  const activeRooms = new Set(res.map((r) => r.key));

  const selectable = (cell: Cell) => {
    if (s.phase === "place") return sel !== null && legal(sel, cell);
    if (s.phase === "placeRobot") return canPlaceRobot(s, cell);
    return false;
  };

  const commitDie = (dieId: number, cell: Cell) => {
    const c = ctx(dieId);
    const list = [...c.pre, { dieId, cell }, ...c.post];
    const next = replay(lockBase, list);
    if (!next) {
      toast.error("That move would break the white die's placement.");
      return;
    }
    setS(next);
    setPlacements(list);
    const nextDie = next.dice.find((d) => !d.cell);
    setSel(nextDie && !next.needsReroll ? nextDie.id : null);
    setPending(null);
    setHover(null);
  };

  const returnDie = (dieId: number) => {
    const c = ctx(dieId);
    const list = [...c.pre, ...c.post];
    const next = replay(lockBase, list);
    if (!next) {
      toast.error("Can't return that die while the white die depends on it.");
      return;
    }
    setS(next);
    setPlacements(list);
    setSel(dieId);
    setPending(null);
  };

  const onCell = (cell: Cell) => {
    if (s.phase === "placeRobot") return setS(placeRobot(s, cell));
    if (sel === null) return;
    if (same(pending, cell)) return commitDie(sel, cell);
    setPending(cell);
  };

  const undo = () => {
    if (!placements.length) return;
    const list = placements.slice(0, -1);
    setS(replay(lockBase, list) ?? lockBase);
    setPlacements(list);
    setPending(null);
    setSel(null);
  };

  // ---- drag & drop ----
  const latest = useRef({ legal, commitDie, returnDie });
  latest.current = { legal, commitDie, returnDie };
  const startDrag = (dieId: number, e: RPointerEvent) => {
    if (s.phase !== "place" || s.needsReroll && !placedIds.has(dieId)) return;
    e.preventDefault();
    setSel(dieId);
    setPending(null);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let target: Cell | null = null;
    let overTray = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true;
      setDrag({ dieId, x: ev.clientX, y: ev.clientY });
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cellEl = el?.closest("[data-cell]") as HTMLElement | null;
      overTray = !!el?.closest("[data-tray]");
      const c = cellEl ? (cellEl.dataset["cell"]!.split(",").map(Number) as Cell) : null;
      target = c && latest.current.legal(dieId, c) ? c : null;
      setHover(target);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      setHover(null);
      if (!moved) return;
      if (target) latest.current.commitDie(dieId, target);
      else if (overTray && placedIds.has(dieId)) latest.current.returnDie(dieId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const unplaced = s.dice.filter((d) => !d.cell);
  const selDie = s.dice.find((d) => d.id === sel);
  const selPlaced = sel !== null && placedIds.has(sel);
  const stuck = selDie && !selDie.cell && !s.needsReroll && !hasLegalPlacement(s, selDie.id);
  const focusCol = previewCell && sel !== null ? previewCell[1] : null;
  const dragDie = drag && s.dice.find((d) => d.id === drag.dieId);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col overflow-x-hidden">
      <Header s={s} onNew={onNew} />
      <main className="flex flex-1 flex-col gap-2 px-2 pb-56 pt-2">
        <Sky s={s} from={selBase} preview={preview} focusCol={focusCol} />
        <Base
          s={s}
          exc={exc}
          digging={exc !== s.excavator}
          selectable={selectable}
          dimmed={false}
          reach={reach}
          onCell={onCell}
          onHover={setHover}
          pending={pending}
          activeRooms={activeRooms}
          movable={movable}
          onDieDown={startDrag}
          draggingId={drag?.dieId ?? null}
        />
        <ol className="space-y-0.5 px-1 text-[11px] text-muted-foreground" aria-label="Game log">
          {s.log.slice(-4).map((l, i) => (
            <li key={`${s.log.length}-${i}`} className={cn(i === Math.min(3, s.log.length - 1) && "text-foreground")}>
              › {l}
            </li>
          ))}
        </ol>
      </main>

      {dragDie && (
        <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 scale-110 drop-shadow-xl" style={{ left: drag.x, top: drag.y }}>
          <DieFace value={dragDie.value} color={dragDie.color} />
        </div>
      )}

      <footer className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-border bg-background/95 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 backdrop-blur">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {s.phase === "place" &&
              (s.needsReroll
                ? "White die placed — reroll! (or move dice first)"
                : pending
                  ? "Tap again or confirm"
                  : selPlaced
                    ? "Move this die, or drag it to the tray"
                    : sel !== null
                      ? "Tap or drag to a glowing space"
                      : "Select a die")}
            {s.phase === "resolve" && "Resolve rooms"}
            {s.phase === "placeRobot" && `Place robot (${s.pendingRobotValue})`}
            {(s.phase === "won" || s.phase === "lost") && "Game over"}
          </span>
          <div className="flex gap-1.5">
            <RulesSheet />
            {s.phase === "place" && (
              <button type="button" onClick={undo} disabled={!placements.length} className="flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-xs disabled:opacity-30">
                <Undo2 className="size-3.5" /> Undo
              </button>
            )}
          </div>
        </div>

        {s.phase === "place" && (
          <>
            <div className="flex justify-between gap-1.5" role="radiogroup" aria-label="Dice tray" data-tray>
              {s.dice.map((d, i) => {
                const placed = !!d.cell;
                const canPick = placed ? placedIds.has(d.id) : !s.needsReroll;
                return (
                  <button
                    key={placed ? `${d.id}-p` : `${d.id}-${s.rollId}`}
                    type="button"
                    disabled={!canPick}
                    onPointerDown={(e) => canPick && startDrag(d.id, e)}
                    aria-label={`${d.color} die ${d.value}${placed ? " (placed)" : ""}`}
                    className={cn(
                      "touch-none rounded-md p-0.5 transition-all",
                      sel === d.id && "-translate-y-1 ring-2 ring-energy box-glow text-energy",
                      placed && "opacity-30",
                      placed && canPick && "opacity-60",
                      drag?.dieId === d.id && "opacity-20",
                    )}
                  >
                    {placed ? <DieFace value={d.value} color={d.color} /> : <RollingDie value={d.value} color={d.color} delay={i} />}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-1.5">
              {selPlaced && !pending ? (
                <ActionBtn tone="muted" onClick={() => returnDie(sel!)}>
                  Return die to tray
                </ActionBtn>
              ) : s.needsReroll ? (
                <ActionBtn tone="warn" onClick={() => { fresh(reroll(s)); setSel(null); }}>
                  <Dices className="size-4" /> Reroll available dice
                </ActionBtn>
              ) : unplaced.length === 0 ? (
                <ActionBtn tone="primary" onClick={() => { fresh(startResolve(s)); setSel(null); }}>
                  End dice phase · Resolve rooms
                </ActionBtn>
              ) : pending && selDie ? (
                <ActionBtn tone="primary" onClick={() => commitDie(selDie.id, pending)}>
                  Place {selDie.value} · ships move {shipMove(selBase, selDie, pending)}
                </ActionBtn>
              ) : stuck ? (
                <ActionBtn tone="muted" onClick={() => {
                  const list = [...placements, { dieId: selDie.id, cell: [-1, -1] as Cell }];
                  setS(replay(lockBase, list)!);
                  setPlacements(list);
                  setSel(null);
                }}>
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
                  const dist = routeIndex(s, d.cell!) - s.excavator;
                  return (
                    <ResolveRow key={x.key} icon={<Pickaxe className="size-4" />} title={`Dig ${dist} · die ${d.value}`} cost={1} ok={d.value >= dist && s.energy >= 1}
                      onUse={() => setS(resolveDig(s, d.id, true))} onSkip={() => setS(resolveDig(s, d.id, false))} />
                  );
                }
                const r = x.room!;
                const c = roomContents(s, r);
                const v = roomValue(s, r);
                return (
                  <ResolveRow key={x.key} icon={<RoomIcons r={r} />}
                    title={`${roomLabel(r)} · value ${v}${c.full ? "" : " (incomplete)"}`} cost={r.cost} ok={c.full && s.energy >= r.cost && v > 0}
                    onUse={() => setS(resolveRoom(s, r.id, true))} onSkip={() => setS(skipRobots(s, r.id))} />
                );
              })}
            </div>
            <ActionBtn tone={res.length ? "muted" : "primary"} onClick={() => { fresh(endRound(s)); setSel(null); }}>
              End round · Mothership descends
            </ActionBtn>
          </div>
        )}

        {s.phase === "placeRobot" && <ActionBtn tone="muted" onClick={() => setS(placeRobot(s, null))}>Discard robot</ActionBtn>}

        {(s.phase === "won" || s.phase === "lost") && (
          <div className="space-y-2 text-center">
            <p className={cn("font-display text-xl font-bold glow", s.phase === "won" ? "text-research" : "text-threat")}>{s.phase === "won" ? "VICTORY" : "BASE LOST"}</p>
            <p className="text-xs text-muted-foreground">{s.endReason}</p>
            <ActionBtn tone="primary" onClick={() => onNew(s.difficulty)}>New game</ActionBtn>
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
