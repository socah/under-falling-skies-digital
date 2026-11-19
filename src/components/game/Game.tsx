import pxEnergy from "@/assets/pano-energy.jpg";
import pxRobot from "@/assets/pano-robot.jpg";
import pxFighter from "@/assets/pano-fighter.jpg";
import pxResearch from "@/assets/pano-research.jpg";
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { BookOpen, Bot, ChevronsDown, Dices, Flag, FlaskConical, Lock, Menu, Pickaxe, Plane, Shield, Skull, Trash2, TriangleAlert, Undo2, Zap } from "lucide-react";
import { toast } from "sonner";
import { BASE_ROWS, COLS, DAMAGE_ROW, MAX_DAMAGE, MAX_ENERGY, CARDS, normalizeSetup, setupLevel, type Difficulty, type MsEffect, type Room, type RoomPart } from "@/game/data";
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
  pendingEnergy,
  roomUsable,
  routeIndex,
  skipRobots,
  startResolve,
  type Cell,
  type GameState,
} from "@/game/engine";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import skyBg from "@/assets/sky-background.jpg";
import baseBg from "@/assets/base-background.jpg";
import alienShip from "@/assets/alien-ship.png";

type Look = "illustrated" | "abstract";
const LookCtx = createContext<{ look: Look; setLook: (l: Look) => void }>({ look: "illustrated", setLook: () => {} });
import { loadStats, recordResult, type SetupStats } from "@/game/stats";
import { clearSave, loadSave, writeSave, type Placement, type SavedGame, type Snapshot } from "@/game/save";

/** Menu actions: start a new game with a setup, either dropping the current one or counting it as a loss. */
type MenuActions = { onNew: (d: Difficulty) => void; onForfeit: (d: Difficulty) => void };
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
const PX: Partial<Record<RoomPart, string>> = { energy: pxEnergy, robot: pxRobot, fighter: pxFighter, research: pxResearch };
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
        "grid grid-cols-3 grid-rows-3 rounded-[22%] border-2",
        small ? "size-8 gap-px p-1" : "size-12 gap-0.5 p-1.5",
        color === "grey" && "die-grey",
        color === "white" && "die-white",
        color === "robot" && "die-robot",
        className,
      )}
    >
      {(PIPS[value] ?? []).map(([r, c], i) => (
        <span
          key={i}
          className={cn("rounded-full", color === "grey" ? "pip-light" : color === "robot" ? "pip-glow" : "pip-engraved")}
          style={{ gridRow: r + 1, gridColumn: c + 1 }}
        />
      ))}
    </span>
  );
}

/** Tumbles through random faces, then lands on the real value. */
function RollingDie({ value, color, delay = 0, className, onDone }: { value: number; color: DieColor; delay?: number; className?: string; onDone?: () => void }) {
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
        onDone?.();
      } else setShown(1 + Math.floor(Math.random() * 6));
    }, 70);
    return () => clearInterval(id);
  }, [value, delay]);
  return <DieFace value={shown} color={color} className={cn(rolling ? "animate-dice-tumble" : "animate-dice-land", className)} />;
}

/* ---------- effects ---------- */
/** Remembers the previous value and reports changes as short-lived keyed events. */
function useChange<T>(value: T, diff: (prev: T, next: T) => number | null, ms = 1200) {
  const prev = useRef(value);
  const [ev, setEv] = useState<{ d: number; k: number } | null>(null);
  useEffect(() => {
    const d = diff(prev.current, value);
    prev.current = value;
    if (d === null || d === 0) return undefined;
    setEv({ d, k: Date.now() });
    const t = setTimeout(() => setEv(null), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return ev;
}

/** A ship that just left the sky: shot down by fighters, or crashed into the base. */
type Boom = { id: number; pos: number; col: number; red: boolean; kind: "shot" | "crash" };
function useBooms(s: GameState) {
  const prev = useRef(s.ships);
  const [booms, setBooms] = useState<Boom[]>([]);
  useEffect(() => {
    const gone: Boom[] = [];
    for (const sh of s.ships) {
      const o = prev.current.find((x) => x.id === sh.id);
      if (!o || o.pos === null || sh.pos !== null) continue;
      if (sh.exit === "crash") gone.push({ id: sh.id, pos: o.pos, col: o.col, red: sh.color === "red", kind: "crash" });
      else if (sh.exit === "shot" && o.pos >= 0) gone.push({ id: sh.id, pos: o.pos, col: o.col, red: sh.color === "red", kind: "shot" });
    }
    prev.current = s.ships;
    if (!gone.length) return undefined;
    setBooms(gone);
    const t = setTimeout(() => setBooms([]), 1400);
    return () => clearTimeout(t);
  }, [s.ships]);
  return booms;
}

/* ---------- sky ---------- */
function EnemyShip({ red, ghost }: { red?: boolean; ghost?: boolean }) {
  const { look } = useContext(LookCtx);
  if (look === "illustrated")
    return (
      <img
        src={alienShip}
        alt=""
        width={24}
        height={24}
        className={cn("size-6", ghost && "animate-ghost opacity-60")}
        style={{ filter: `${red ? "hue-rotate(250deg) saturate(2) " : ""}drop-shadow(0 0 3px ${red ? "var(--threat)" : "var(--research)"})` }}
      />
    );
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
  if (!e) return <span className="size-1 rounded-full bg-muted-foreground/40" />;
  const cls = "flex items-center gap-px text-[9px] font-bold";
  if (e.t === "skull") return <Skull className="size-3.5 text-foreground" />;
  if (e.t === "damage") return <span className={cn(cls, "text-threat")}>✸</span>;
  if (e.t === "red") return <span className={cn(cls, "text-threat")}>+<EnemyShip red /></span>;
  if (e.t === "exc") return <span className={cn(cls, "text-muted-foreground")}>-{e.n}<Pickaxe className="size-3" /></span>;
  return <span className={cn(cls, "text-research")}>-{e.n}<FlaskConical className="size-3" /></span>;
}

function Sky({ s, from, preview, focusCol, menu }: { s: GameState; from: GameState; preview: GameState | null; focusCol: number | null; menu: MenuActions }) {
  const { look } = useContext(LookCtx);
  const booms = useBooms(s);
  const b = board(s);
  const ghosts = preview
    ? preview.ships.filter((p) => {
        const o = from.ships.find((x) => x.id === p.id)!;
        return p.pos !== null && (p.pos !== o.pos || p.col !== o.col);
      })
    : [];
  // Ships this placement would send into the base: previewed on the damage row with a warning.
  const crashers = preview
    ? preview.ships.filter((p) => {
        const o = from.ships.find((x) => x.id === p.id)!;
        return p.pos === null && o.pos !== null && p.exit === "crash";
      })
    : [];
  const shipStyle = (pos: number, col: number) => ({ top: (pos + 1) * ROW_H, height: ROW_H, left: `calc(${col * 20}% + 10% - 12px)` });
  // A ship pushed sideways by an arrow moves down to the arrow first, then sideways (reversed when undoing),
  // instead of sliding diagonally. The timing is remembered per ship until it moves again, so re-renders don't change it.
  const moves = useRef(new Map<number, { pos: number; col: number; t: string }>());
  const shipTransition = (id: number, pos: number, col: number) => {
    const m = moves.current.get(id);
    if (m && m.pos === pos && m.col === col) return m.t;
    let tr = "top 500ms ease-out, left 500ms ease-out";
    if (m && m.col !== col) tr = pos >= m.pos ? "top 400ms ease-out, left 300ms ease-in-out 400ms" : "left 300ms ease-in-out, top 400ms ease-out 300ms";
    moves.current.set(id, { pos, col, t: tr });
    return tr;
  };
  return (
    <section
      className={cn("relative grid grid-cols-[2.5rem_minmax(0,1fr)] rounded-md border border-border bg-cover bg-center", look === "abstract" && "sky-gradient")}
      style={look === "illustrated" ? { backgroundImage: `linear-gradient(rgb(0 0 0 / 0.35), rgb(0 0 0 / 0.35)), url(${skyBg})` } : undefined}
      aria-label="Sky"
    >
      <div className="relative border-r border-border/60" style={{ height: SKY_ROWS * ROW_H }}>
        {b.msEffects.map((e, r) => (
          <div key={r} className="absolute inset-x-0 flex items-center justify-center border-t border-border/30" style={{ top: (r + 1) * ROW_H, height: ROW_H }}>
            {e && <MsGlyph e={e} />}
          </div>
        ))}
        <SideStats s={s} menu={menu} free={[-1, ...b.msEffects.flatMap((e, r) => (e || r > b.skullRow ? [] : [r]))]} />
        <HullBoxes damage={s.damage} top={(b.skullRow + 2) * ROW_H} />
        <div className="absolute -right-1.5 z-20 flex items-center text-research glow transition-all duration-700" style={{ top: (s.mothership + 1) * ROW_H, height: ROW_H }}>
          ▶
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden" style={{ height: SKY_ROWS * ROW_H }}>
        {b.msEffects.map((_, r) => (
          <div key={`l${r}`} className="absolute inset-x-0 border-t border-border/30" style={{ top: (r + 1) * ROW_H }} />
        ))}
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
        <div className="absolute inset-x-0 top-0 z-10 mothership-hull transition-[height] duration-700 ease-out" style={{ height: (s.mothership + 1) * ROW_H, borderRadius: "0 0 40% 40% / 0 0 10px 10px" }}>
          <div className="absolute inset-x-0 bottom-0 flex" style={{ height: ROW_H }}>
            {Array.from({ length: COLS }, (_, c) => (
              <div key={c} className="flex flex-1 items-center justify-center">
                <span className="size-3 border border-research/70" />
              </div>
            ))}
          </div>
        </div>
        {s.ships.map((sh) => {
          if (sh.pos === null) return null;
          const ic = b.sky[sh.pos]?.[sh.col];
          return ic?.t === "exp" ? (
            <span key={`t${sh.id}`} aria-label={`Shooting threshold ${ic.v}`} className="absolute z-30 -translate-y-1/2 rounded-sm border border-background bg-warn px-0.5 text-[10px] font-bold leading-tight text-background" style={{ top: (sh.pos + 1.5) * ROW_H, left: `calc(${sh.col * 20}% + 10% + 10px)`, transition: shipTransition(sh.id, sh.pos, sh.col) }}>
              {ic.v}+
            </span>
          ) : null;
        })}
        {s.ships.map((sh) =>
          sh.pos === null ? null : (
            <div key={sh.id} data-ship-row={sh.pos} className="absolute z-20 flex items-center" style={{ ...shipStyle(sh.pos, sh.col), transition: shipTransition(sh.id, sh.pos, sh.col) }}>
              <EnemyShip red={sh.color === "red"} />
            </div>
          ),
        )}
        {booms.map((x) =>
          x.kind === "shot" ? (
            <div key={`b${x.id}-${x.pos}`}>
              <div className="absolute z-20 w-0.5 animate-laser bg-energy shadow-[0_0_8px_var(--energy)]" style={{ left: `calc(${x.col * 20}% + 10% - 1px)`, top: (x.pos + 1.5) * ROW_H, height: (SKY_ROWS - x.pos - 1.5) * ROW_H }} />
              <div className="absolute z-30 size-7 animate-boom rounded-full bg-[radial-gradient(circle,var(--warn),var(--threat)_55%,transparent_70%)]" style={{ top: (x.pos + 1) * ROW_H - 3, left: `calc(${x.col * 20}% + 10% - 14px)` }} />
            </div>
          ) : (
            <div key={`c${x.id}-${x.pos}`}>
              {/* The ship dives to the damage row, then explodes against the base. */}
              <div
                className="absolute z-20 flex animate-crash items-center"
                style={{ ...shipStyle(x.pos, x.col), ["--from" as string]: `${(x.pos + 1) * ROW_H}px`, ["--to" as string]: `${(DAMAGE_ROW + 1) * ROW_H}px` }}
              >
                <EnemyShip red={x.red} />
              </div>
              <div className="absolute z-30 size-11 animate-crash-boom rounded-full bg-[radial-gradient(circle,white,var(--warn)_25%,var(--threat)_55%,transparent_70%)]" style={{ top: (DAMAGE_ROW + 1.5) * ROW_H - 22, left: `calc(${x.col * 20}% + 10% - 22px)` }} />
              <div className="absolute z-30 size-11 animate-crash-ring rounded-full border-2 border-warn" style={{ top: (DAMAGE_ROW + 1.5) * ROW_H - 22, left: `calc(${x.col * 20}% + 10% - 22px)` }} />
            </div>
          ),
        )}
        {ghosts.map((sh) => sh.pos === null ? null : (
          <div key={`g${sh.id}`} className="absolute z-20 flex items-center" style={shipStyle(sh.pos, sh.col)}>
            <EnemyShip red={sh.color === "red"} ghost />
          </div>
        ))}
        {crashers.map((sh) => (
          <div key={`x${sh.id}`} aria-label="This ship would hit the base" className="absolute z-30 flex items-center" style={shipStyle(DAMAGE_ROW, sh.col)}>
            <EnemyShip red={sh.color === "red"} ghost />
            <TriangleAlert className="absolute -right-2.5 -top-1 size-3.5 animate-pulse fill-background text-threat drop-shadow-[0_0_3px_var(--threat)]" />
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

/** Memoised: while dragging, only the hovered space changes, and the base doesn't depend on it (the sky's preview does). */
const Base = memo(function Base({
  s,
  exc,
  digging,
  selectable,
  dimmed,
  reach,
  onCell,
  onHover,
  activeRooms,
  movable,
  onDieDown,
  draggingId,
}: {
  s: GameState;
  exc: number;
  digging: boolean;
  selectable: Set<string>; // keys of the spaces that can be picked now
  dimmed: boolean;
  reach: number | null; // furthest route index the selected die can dig to
  onCell: (c: Cell) => void;
  onHover: (c: Cell | null) => void;
  activeRooms: Set<string>;
  movable: Set<number>; // dice that can be picked up again
  onDieDown: (dieId: number, e: RPointerEvent) => void;
  draggingId: number | null;
}) {
  const rAdv = useChange(s.research, (a, b) => b - a, 1800);
  const { look } = useContext(LookCtx);
  const b = board(s);
  const route = b.route;
  const inRoom = new Set(b.rooms.flatMap((r) => r.cells.map(key)));
  const emptyRoute = route.filter((c) => !inRoom.has(key(c)));
  const center = (c: Cell) => ({ x: `${(c[1] + 0.5) * 20}%`, y: (c[0] + 0.5) * CELL_H });
  const prevExc = useRef(exc);
  const justDug = useRef(new Set<string>());
  if (exc !== prevExc.current) {
    if (exc > prevExc.current) justDug.current = new Set(route.slice(prevExc.current, exc).map(key));
    prevExc.current = exc;
  }
  const slots: Cell[] = [...b.rooms.flatMap((r) => r.cells), ...emptyRoute];
  const excCell = route[exc] ?? route[0];

  return (
    <section
      aria-label="Underground base"
      className="grid grid-cols-[2.5rem_minmax(0,1fr)] rounded-md border border-border bg-card"
    >
      <div className="flex flex-col-reverse items-stretch gap-0.5 border-r border-border/60 px-1 py-1" aria-label="Research track">
        {b.research.slice(1).map((v, i) => (
          <span
            key={i}
            className={cn(
              "flex flex-1 items-center justify-center rounded-[2px] border text-[11px] font-bold leading-none tabular-nums transition-colors duration-500",
              i < s.research ? "border-research bg-research text-primary-foreground" : "border-border bg-background/40 text-foreground/85",
              rAdv && rAdv.d > 0 && i >= s.research - rAdv.d && i < s.research && "animate-glow-pulse",
              i === b.research.length - 2 && "border-research",
            )}
          >
            {v}
          </span>
        ))}
        <FlaskConical className="mx-auto size-3 shrink-0 text-research" />
      </div>
      <div className="relative flex-1" style={{ height: BASE_ROWS * CELL_H }}>
        {look === "illustrated" && route.filter((c) => !isExcavated(s, c)).map((c) => (
          <div key={`ground-${key(c)}`} className="pointer-events-none absolute bg-cover opacity-55" style={{ ...cellBox(c), backgroundImage: `url(${baseBg})` }} />
        ))}
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
                  !usable && "opacity-20",
                  activeRooms.has(r.id) && "box-glow text-energy",
                  dimmed && "opacity-50",
                )}
              >
                {look === "illustrated" && usable && (
                  <span className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-[1px] opacity-60">
                    {r.parts.map((p, i) => {
                      // Each column of the board maps to its own fifth of the room panorama, so tiles never repeat.
                      const w = Math.max(...cs) - c0 + 1;
                      const k = w / r.parts.length;
                      const a = c0 + k * i;
                      return PX[p] && (
                        <span key={p} className="h-full min-w-0 flex-1 bg-no-repeat [image-rendering:pixelated]"
                          style={{ backgroundImage: `url(${PX[p]})`, backgroundSize: `${(5 / k) * 100}% 165%`, backgroundPosition: `${k < 5 ? (a / (5 - k)) * 100 : 0}% 45%` }} />
                      );
                    })}
                  </span>
                )}
                <RoomIcons r={r} className="pointer-events-none absolute left-1 top-0.5 opacity-70" />
                {r.mod !== 0 && <span className="absolute right-0.5 top-0.5 rounded-sm bg-background px-1 text-[10px] font-bold text-foreground">{r.mod > 0 ? `+${r.mod}` : r.mod}</span>}
              </div>
            </div>
          );
        })}
        {/* Costs sit above placement highlights, independently of room opacity. */}
        {b.rooms.filter((r) => r.cost > 0).map((r) => {
          const left = Math.min(...r.cells.map((c) => c[1]));
          const right = Math.max(...r.cells.map((c) => c[1]));
          const bottom = Math.max(...r.cells.map((c) => c[0]));
          const usable = roomUsable(s, r);
          return (
            <div key={`cost-${r.id}`} aria-label={`${roomLabel(r)} energy cost ${r.cost}`} className="pointer-events-none absolute z-40 flex -translate-x-1/2 gap-px" style={{ left: `${(left + right + 1) * 10}%`, top: (bottom + 1) * CELL_H - 10 }}>
              {Array.from({ length: r.cost }, (_, i) => (
                <span key={i} className={cn("flex size-3.5 items-center justify-center rounded-full", usable ? "bg-room-energy text-background" : "bg-room-energy/35 text-background/80")}>
                  <Zap className="size-2.5" />
                </span>
              ))}
            </div>
          );
        })}
        {/* excavator route */}
        <svg className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible" aria-hidden>
          {route.slice(1).map((c, j) => {
            const i = j + 1;
            if (i <= exc) return null;
            const previous = route[i - 1];
            if (!previous) return null;
            const a = center(previous);
            const z = center(c);
            const reachable = reach !== null && i > exc && i <= reach;
            // Reachable path: a wide faint line under a bright one gives the glow without a per-frame-repainting filter.
            return (
              <g key={i}>
              {reachable && <line x1={a.x} y1={a.y} x2={z.x} y2={z.y} strokeLinecap="round" strokeWidth={9} className="stroke-energy opacity-30" />}
              <line
                x1={a.x}
                y1={a.y}
                x2={z.x}
                y2={z.y}
                strokeLinecap="round"
                strokeWidth={reachable ? 4 : 2}
                className={cn(
                  "transition-all duration-300",
                  reachable ? "stroke-energy" : "stroke-muted-foreground/25",
                  reach !== null && !reachable && "opacity-25",
                )}
              />
              </g>
            );
          })}
        </svg>
        {/* slots */}
        {slots.map((cell) => {
          const die = s.dice.find((d) => same(d.cell, cell));
          const robot = s.robots.find((r) => same(r.cell, cell));
          const ok = selectable.has(key(cell));
          const canMove = die && movable.has(die.id);
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
                )}
              >
                {die && die.cell![0] >= 0 && (
                  <span
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={canMove ? (e) => onDieDown(die.id, e) : undefined}
                    data-die={die.id}
                    className={cn("relative", canMove && "cursor-grab touch-none", draggingId === die.id && "opacity-30")}
                  >
                    <DieFace small value={die.value} color={die.color} className={cn(die.resolved && "opacity-25")} />
                    {!canMove && s.phase === "place" && <Lock className="absolute -right-1 -top-1 size-3 text-muted-foreground" />}
                  </span>
                )}
                {robot && <DieFace small value={robot.value} color="robot" className={cn("transition-transform duration-500", robot.used && "rotate-45", robot.fresh && "animate-pop opacity-70")} />}
              </div>
            </div>
          );
        })}
        {/* excavator token */}
        {excCell && <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-linear"
          style={{ left: `${(excCell[1] + 0.5) * 20}%`, top: (excCell[0] + 0.5) * CELL_H }}
          aria-label="Excavator"
        >
          <span className="relative flex size-8 items-center justify-center rounded-full border border-research bg-background text-research box-glow">
            <Pickaxe className={cn("size-5", digging && "animate-dig")} />
            {digging && <span className="absolute inset-0 animate-ping rounded-full bg-warn/60" />}
          </span>
        </div>}
      </div>
    </section>
  );
});

/* ---------- header & menus ---------- */
/** Round and menu tucked into the free rows of the mothership-effect column. */
function SideStats({ s, menu, free }: { s: GameState; menu: MenuActions; free: number[] }) {
  const items: ReactNode[] = [
    <GameMenu key="m" s={s} menu={menu} />,
  ];
  let k = 0;
  return (
    <>
      {items.map((it) => {
        if (!it) return null;
        const r = free[k++];
        if (r === undefined) return null;
        return (
          <div key={(it as { key: string }).key} className="absolute inset-x-0 z-30 flex items-center justify-center" style={{ top: (r + 1) * ROW_H, height: ROW_H }}>
            {it}
          </div>
        );
      })}
    </>
  );
}

/** Hull points, stacked vertically under the mothership-effect column. */
function HullBoxes({ damage, top }: { damage: number; top: number }) {
  const hit = useChange(damage, (a, b) => (b > a ? b - a : null), 900);
  return (
    <div title={`Hull ${MAX_DAMAGE - damage}/${MAX_DAMAGE}`} aria-label={`Hull ${MAX_DAMAGE - damage} of ${MAX_DAMAGE}`} className="absolute inset-x-0 bottom-1 z-30 flex flex-col items-center justify-end gap-0.5" style={{ top }}>
      <Shield className={cn("size-3", damage ? "text-threat" : "text-research")} />
      <div key={hit?.k} className={cn("flex flex-col-reverse gap-0.5", hit && "animate-hit")}>
        {Array.from({ length: MAX_DAMAGE }, (_, i) => (
          <span key={i} className={cn("h-2.5 w-4 rounded-[2px] border transition-colors duration-300", i < MAX_DAMAGE - damage ? "border-research bg-research text-research box-glow" : "border-threat/50 bg-threat/20")} />
        ))}
      </div>
    </div>
  );
}

/** Energy, in a row in the bottom controls. */
function EnergyTrack({ s }: { s: GameState }) {
  const gain = s.phase === "place" || s.phase === "resolve" ? pendingEnergy(s) : 0;
  const dE = useChange(s.energy, (a, b) => b - a);
  return (
    <span aria-label={`Energy ${s.energy} of ${MAX_ENERGY}`} title={`Energy ${s.energy}/${MAX_ENERGY}${gain ? ` (+${gain} this turn)` : ""}`} className="relative flex shrink-0 items-center gap-0.5">
      <Zap className="mr-0.5 size-3.5 text-room-energy" />
      {Array.from({ length: MAX_ENERGY }, (_, i) => (
        <span key={i} className={cn("h-4 w-2 rounded-[2px] border transition-colors duration-300",
          i < s.energy ? "border-room-energy bg-room-energy text-room-energy box-glow" : i < s.energy + gain ? "border-room-energy/80 bg-room-energy/25 animate-glow-pulse" : "border-room-energy/30 bg-background/40")} />
      ))}
      {dE && (
        <span key={dE.k} className={cn("pointer-events-none absolute -top-4 right-0 animate-float-up text-xs font-bold", dE.d > 0 ? "text-room-energy" : "text-threat")}>
          {dE.d > 0 ? `+${dE.d}` : dE.d}
        </span>
      )}
    </span>
  );
}

/** Red pulse around the screen edges whenever the base takes damage. */
function DamageFlash({ damage }: { damage: number }) {
  const hit = useChange(damage, (a, b) => (b > a ? b - a : null), 1600);
  return hit ? <div key={hit.k} aria-hidden className="pointer-events-none fixed inset-0 z-[60] animate-damage-vignette" /> : null;
}

const ALL_E = "e".repeat(CARDS.length);
const ALL_H = "h".repeat(CARDS.length);
const pct = (x: SetupStats) => `${Math.round((100 * x.won) / x.played)}%`;
function setupLabel(code: string) {
  const l = setupLevel(code);
  if (l === 0) return "All easy";
  if (l === CARDS.length) return "All hard";
  return CARDS.filter((_, i) => code[i] === "h").map((c) => c.name).join(" + ");
}

function GameMenu({ s, menu }: { s: GameState; menu: MenuActions }) {
  const current = s.difficulty;
  const log = s.log;
  const [open, setOpen] = useState(false);
  // Second tap confirms, so a stray tap in the menu can't end the game.
  const [confirm, setConfirm] = useState<"forfeit" | "abandon" | null>(null);
  const over = s.phase === "won" || s.phase === "lost";
  const started = s.round > 1 || s.phase !== "place" || s.dice.some((x) => x.cell);
  const [d, setD] = useState(normalizeSetup(current));
  const [stats, setStats] = useState<Record<string, SetupStats>>({});
  const flip = (i: number) => setD((x) => x.slice(0, i) + (x[i] === "h" ? "e" : "h") + x.slice(i + 1));
  const cur = stats[d];
  const history = Object.entries(stats).sort((a, b) => setupLevel(a[0]) - setupLevel(b[0]) || b[1].last - a[1].last);
  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); setConfirm(null); if (o) { setD(normalizeSetup(current)); setStats(loadStats()); } }}>
      <SheetTrigger asChild>
        <button type="button" aria-label="Menu" className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground">
          <Menu className="size-3.5" />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto border-border bg-card font-mono">
        <SheetHeader>
          <SheetTitle className="font-display text-research">Menu</SheetTitle>
        </SheetHeader>
        <div className="mx-auto w-full max-w-md space-y-3 px-4 pb-6">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Card sides · level {setupLevel(d)}</p>
            <div className="flex gap-1 text-[11px]">
              <button type="button" onClick={() => setD(ALL_E)} className={cn("rounded-sm border px-2 py-0.5", d === ALL_E ? "border-research text-research" : "border-border text-muted-foreground")}>All easy</button>
              <button type="button" onClick={() => setD(ALL_H)} className={cn("rounded-sm border px-2 py-0.5", d === ALL_H ? "border-threat text-threat" : "border-border text-muted-foreground")}>All hard</button>
            </div>
          </div>
          <ul className="space-y-1" aria-label="Card sides">
            {CARDS.map((c, i) => {
              const hard = d[i] === "h";
              return (
                <li key={c.id}>
                  <button type="button" role="switch" aria-checked={hard} onClick={() => flip(i)}
                    className={cn("flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left", hard ? "border-threat/70 bg-threat/10" : "border-border")}>
                    <span className="flex-1">
                      <b className="block text-xs text-foreground">{c.name}</b>
                      <span className="block text-[10px] text-muted-foreground">{c.hint}</span>
                    </span>
                    <span className={cn("w-14 rounded-sm px-1.5 py-0.5 text-center text-[10px] font-bold uppercase", hard ? "bg-threat text-primary-foreground" : "bg-research/20 text-research")}>
                      {hard ? "★ Hard" : "Easy"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            This setup: {cur ? `${cur.won}/${cur.played} won (${pct(cur)})${cur.bestRounds !== null ? ` · best win in ${cur.bestRounds} rounds` : ""}` : "not played yet"}
          </p>
          <LookPicker />
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer select-none uppercase tracking-widest">Action log</summary>
            <ol className="mt-2 max-h-40 space-y-1 overflow-y-auto" aria-label="Game log">
              {log.map((entry, i) => (
                <li key={i} className={cn(i === log.length - 1 && "text-foreground")}>› {entry}</li>
              ))}
            </ol>
          </details>
          {over || !started ? (
            <ActionBtn tone="primary" onClick={() => { menu.onNew(d); setOpen(false); }}>
              Start new game
            </ActionBtn>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">Start a new game with the setup above. The current game (round {s.round}) will be:</p>
              <div className="flex gap-1.5">
                <ActionBtn tone={confirm === "forfeit" ? "warn" : "muted"} onClick={() => {
                  if (confirm !== "forfeit") return setConfirm("forfeit");
                  menu.onForfeit(d);
                  setOpen(false);
                }}>
                  {confirm === "forfeit" ? "Tap to confirm" : <><Flag className="size-3.5" /> Forfeit</>}
                </ActionBtn>
                <ActionBtn tone={confirm === "abandon" ? "warn" : "muted"} onClick={() => {
                  if (confirm !== "abandon") return setConfirm("abandon");
                  menu.onNew(d);
                  setOpen(false);
                }}>
                  {confirm === "abandon" ? "Tap to confirm" : <><Trash2 className="size-3.5" /> Abandon</>}
                </ActionBtn>
              </div>
              <p className="text-[10px] text-muted-foreground">Forfeit counts as a loss in your stats · Abandon isn't counted.</p>
            </div>
          )}
          {history.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">Past games</p>
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground">
                  <tr><th className="text-left font-normal">Setup</th><th className="font-normal">Lvl</th><th className="font-normal">Won</th><th className="font-normal">Best</th></tr>
                </thead>
                <tbody>
                  {history.map(([code, x]) => (
                    <tr key={code} onClick={() => setD(code)} className={cn("cursor-pointer border-t border-border/50", code === d && "text-research")}>
                      <td className="py-1 pr-2">{setupLabel(code)}</td>
                      <td className="text-center">{setupLevel(code)}</td>
                      <td className="text-center">{x.won}/{x.played} · {pct(x)}</td>
                      <td className="text-center">{x.bestRounds ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LookPicker() {
  const { look, setLook } = useContext(LookCtx);
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">Look</p>
      <div className="flex gap-1 text-[11px]" role="radiogroup" aria-label="Look">
        {(["illustrated", "abstract"] as const).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={look === l} onClick={() => setLook(l)}
            className={cn("rounded-sm border px-2 py-0.5 capitalize", look === l ? "border-research text-research" : "border-border text-muted-foreground")}>
            {l}
          </button>
        ))}
      </div>
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
          <p><b className="text-foreground">1 · Place dice.</b> Roll 3 white + 2 dark. Tap or drag a die onto a space; max one die per column. Ships in that column descend by the die value. Placing a dark die forces a reroll of the unplaced dice. Until you reroll, you can drag placed dice to other spaces or back to the tray.</p>
          <p><b className="text-foreground">Sky icons.</b> ◀ ▶ shift the ship sideways if the space is free. Saucer: the mothership descends a row. Explosion N+: fighters with value ≥ N can shoot ships there. Reaching the city = 1 damage.</p>
          <p><b className="text-foreground">Excavator.</b> One die per round may go on an undug space beyond the excavator, no further than its value. At resolve, pay 1 energy to move there. Only spaces behind the excavator are excavated; its current space is occupied and does not unlock a room.</p>
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
const startGame = (d: Difficulty): SavedGame => {
  const s = newGame(Math.random, d);
  return { s, lockBase: s, placements: [], history: [] };
};

export function Game() {
  const [game, setGame] = useState<{ g: SavedGame; n: number } | null>(null);
  const [look, setLookState] = useState<Look>("illustrated");
  useEffect(() => {
    if (localStorage.getItem("ufs-look") === "abstract") setLookState("abstract");
  }, []);
  // Resume the saved game if there is one (an unreadable or outdated save is ignored); otherwise start fresh.
  useEffect(() => {
    const saved = loadSave();
    setGame({ g: saved ?? startGame(normalizeSetup(localStorage.getItem("ufs-difficulty") ?? "easy")), n: 0 });
  }, []);
  if (!game) return <div className="flex min-h-screen items-center justify-center text-research glow">Booting bunker…</div>;
  const onNew = (d: Difficulty) => {
    localStorage.setItem("ufs-difficulty", d);
    clearSave();
    setGame((g) => ({ g: startGame(d), n: (g?.n ?? 0) + 1 }));
  };
  return (
    <LookCtx.Provider value={{ look, setLook: (l) => { localStorage.setItem("ufs-look", l); setLookState(l); } }}>
      <GameView key={game.n} initial={game.g} onNew={onNew} />
    </LookCtx.Provider>
  );
}

function GameView({ initial, onNew }: { initial: SavedGame; onNew: (d: Difficulty) => void }) {
  const [s, setS] = useState<GameState>(initial.s);
  const [lockBase, setLockBase] = useState<GameState>(initial.lockBase);
  const recorded = useRef(false);
  const rolled = useRef<{ roll: number; ids: Set<number> }>({ roll: -1, ids: new Set() });
  useEffect(() => {
    if (recorded.current || (s.phase !== "won" && s.phase !== "lost")) return;
    recorded.current = true;
    recordResult(s.difficulty, s.phase === "won", s.round);
  }, [s.phase, s.difficulty, s.round]);
  const [placements, setPlacements] = useState<Placement[]>(initial.placements);
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  // Where a drag started; the floating die is then moved directly via `ghostRef`, without re-rendering the game.
  const [drag, setDrag] = useState<{ dieId: number; x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [exc, setExc] = useState(initial.s.excavator);

  // walk the excavator token one space at a time
  useEffect(() => {
    if (exc === s.excavator) return undefined;
    const t = setTimeout(() => setExc((e) => e + Math.sign(s.excavator - e)), 300);
    return () => clearTimeout(t);
  }, [exc, s.excavator]);

  // FLIP: remember where every die sits before a move, then glide it from there.
  const flip = useRef<Map<number, DOMRect> | null>(null);
  const snap = (dieId?: number, at?: { x: number; y: number }) => {
    const m = new Map<number, DOMRect>();
    document.querySelectorAll<HTMLElement>("[data-die]").forEach((el) => m.set(Number(el.dataset["die"]), el.getBoundingClientRect()));
    if (dieId !== undefined && at) m.set(dieId, new DOMRect(at.x - 14, at.y - 14, 28, 28));
    flip.current = m;
  };
  useLayoutEffect(() => {
    const prev = flip.current;
    if (!prev) return;
    flip.current = null;
    document.querySelectorAll<HTMLElement>("[data-die]").forEach((el) => {
      const p = prev.get(Number(el.dataset["die"]));
      if (!p) return;
      const r = el.getBoundingClientRect();
      const dx = p.left + p.width / 2 - (r.left + r.width / 2);
      const dy = p.top + p.height / 2 - (r.top + r.height / 2);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  });
  /** Start from a new locked state (reroll, new round): nothing before it can be undone. */
  const fresh = (next: GameState) => {
    setS(next);
    setLockBase(next);
    setPlacements([]);
    setHistory([]);
  };

  // Undo for the resolve phase: snapshots taken before each step (resolving is deterministic, so it's fair).
  const [history, setHistory] = useState<Snapshot[]>(initial.history);

  // Save after every change so closing the app never loses the game (cleared once it's won or lost).
  useEffect(() => {
    writeSave({ s, lockBase, placements, history });
  }, [s, lockBase, placements, history]);

  const menu: MenuActions = {
    onNew,
    onForfeit: (d) => {
      if (!recorded.current) recordResult(s.difficulty, false, s.round);
      recorded.current = true;
      onNew(d);
    },
  };
  const act = (next: GameState, lock = false) => {
    setHistory((h) => [...h, { s, lockBase, placements }]);
    setS(next);
    if (lock) {
      setLockBase(next);
      setPlacements([]);
    }
  };
  const undoStep = () => {
    const last = history.at(-1);
    if (!last) return;
    snap();
    setHistory((h) => h.slice(0, -1));
    setS(last.s);
    setLockBase(last.lockBase);
    setPlacements(last.placements);
    setSel(null);
  };

  // The footer is fixed over the page; pad the page by its real height so the whole board can be scrolled into view.
  const footerRef = useRef<HTMLElement>(null);
  const [footerH, setFooterH] = useState(224);
  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setFooterH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placedIds = new Set(placements.filter((p) => p.cell[0] >= 0).map((p) => p.dieId));
  const movable = useMemo(
    () => new Set(s.phase === "place" ? placements.filter((p) => p.cell[0] >= 0).map((p) => p.dieId) : []),
    [s.phase, placements],
  );

  /** State to evaluate a die against: without it (if it's being moved) and before any trailing dark die. */
  const ctx = (dieId: number) => {
    if (!placedIds.has(dieId)) return { base: s as GameState | null, pre: placements, post: [] as Placement[] };
    let pre = placements.filter((p) => p.dieId !== dieId);
    let post: Placement[] = [];
    const last = pre.at(-1);
    if (last && s.dice.find((d) => d.id === last.dieId)?.color === "grey") {
      post = [last];
      pre = pre.slice(0, -1);
    }
    return { base: replay(lockBase, pre), pre, post };
  };
  // Replaying placements is the expensive part: do it once for the selected die, not for every board space.
  const selCtx = useMemo(
    () => (sel !== null ? ctx(sel) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, s, lockBase, placements],
  );
  const legal = (dieId: number, cell: Cell) => {
    const b = dieId === sel && selCtx ? selCtx.base : ctx(dieId).base;
    return !!b && !canPlace(b, dieId, cell);
  };

  const selBase = selCtx?.base ?? s;
  const previewCell = hover;
  const preview = useMemo(() => {
    if (sel === null || !previewCell || !selCtx?.base || canPlace(selCtx.base, sel, previewCell)) return null;
    return placeDie(selCtx.base, sel, previewCell);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, sel, previewCell, placements]);

  const dig = s.phase === "place" && sel !== null && selCtx?.base ? digTargets(selCtx.base, sel) : [];
  const reach = s.phase === "place" && sel !== null ? (dig.length ? Math.max(...dig.map((c) => routeIndex(s, c))) : s.excavator) : null;

  const res = s.phase === "resolve" ? resolvables(s) : [];
  const activeRooms = useMemo(() => new Set(res.map((r) => r.key)), [res.map((r) => r.key).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Whether "Use" would do anything for this option right now (enough energy, high enough value). */
  const usableNow = (x: (typeof res)[number]) => {
    if (x.dieId !== undefined) {
      const d = s.dice.find((dd) => dd.id === x.dieId)!;
      return d.value >= routeIndex(s, d.cell!) - s.excavator && s.energy >= 1;
    }
    const r = x.room!;
    return roomContents(s, r).full && s.energy >= r.cost && roomValue(s, r) > 0;
  };
  // Nothing left that can be used (e.g. every room needs energy you don't have, and no generator can add any): ending the round is the only move.
  const nothingUsable = res.every((x) => !usableNow(x));

  const selectable = useMemo(() => {
    const ok = (cell: Cell) => {
      if (s.phase === "place") return sel !== null && legal(sel, cell);
      if (s.phase === "placeRobot") return canPlaceRobot(s, cell);
      return false;
    };
    const b = board(s);
    return new Set([...b.rooms.flatMap((r) => r.cells), ...b.route].filter(ok).map(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, sel, selCtx]);

  const commitDie = (dieId: number, cell: Cell, at?: { x: number; y: number }) => {
    snap(dieId, at);
    const c = ctx(dieId);
    const list = [...c.pre, { dieId, cell }, ...c.post];
    const next = replay(lockBase, list);
    if (!next) {
      toast.error("That move would break the dark die's placement.");
      return;
    }
    if (next.needsReroll && next.dice.some((d) => !d.cell)) {
      // Dark die placed with dice left: lock everything and reroll the rest right away.
      fresh(reroll(next));
      setSel(null);
      setHover(null);
      return;
    }
    setS(next);
    setPlacements(list);
    setSel(null);
    setHover(null);
  };

  const returnDie = (dieId: number, at?: { x: number; y: number }) => {
    snap(dieId, at);
    const c = ctx(dieId);
    const list = [...c.pre, ...c.post];
    const next = replay(lockBase, list);
    rolled.current.ids.add(dieId);
    if (!next) {
      toast.error("Can't return that die while the dark die depends on it.");
      return;
    }
    setS(next);
    setPlacements(list);
    setSel(dieId);
  };

  const onCell = (cell: Cell) => {
    if (s.phase === "placeRobot") return act(placeRobot(s, cell));
    if (sel === null || !legal(sel, cell)) return;
    commitDie(sel, cell);
  };

  const undo = () => {
    if (!placements.length) return;
    snap();
    const list = placements.slice(0, -1);
    const last = placements.at(-1);
    if (last) rolled.current.ids.add(last.dieId);
    setS(replay(lockBase, list) ?? lockBase);
    setPlacements(list);
    setSel(null);
  };

  // ---- drag & drop ----
  const latest = useRef({ legal, commitDie, returnDie, onCell, startDrag: (_d: number, _e: RPointerEvent) => {} });
  const startDrag = (dieId: number, e: RPointerEvent) => {
    if (s.phase !== "place" || s.needsReroll && !placedIds.has(dieId)) return;
    e.preventDefault();
    const wasSelected = sel === dieId;
    setSel(dieId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let target: Cell | null = null;
    let targetKey = "";
    let overTray = false;
    let at = { x: x0, y: y0 };
    let frame = 0;
    // At most once per screen frame: move the floating die and work out which space is under the finger.
    const update = () => {
      frame = 0;
      ghostRef.current?.style.setProperty("transform", `translate3d(${at.x - x0}px, ${at.y - y0}px, 0)`);
      const el = document.elementFromPoint(at.x, at.y);
      const cellEl = el?.closest("[data-cell]") as HTMLElement | null;
      overTray = !!el?.closest("[data-tray]");
      const c = cellEl ? (cellEl.dataset["cell"]!.split(",").map(Number) as Cell) : null;
      const next = c && latest.current.legal(dieId, c) ? c : null;
      const k = next ? key(next) : "";
      if (k !== targetKey) {
        // Only re-render (highlight + ship preview) when the target space actually changes.
        targetKey = k;
        target = next;
        setHover(next);
      }
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) setDrag({ dieId, x: x0, y: y0 });
      moved = true;
      at = { x: ev.clientX, y: ev.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    };
    const up = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        if (moved) update();
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      setHover(null);
      if (!moved) {
        if (wasSelected) setSel(null);
        return;
      }
      if (target) latest.current.commitDie(dieId, target, at);
      else if (overTray && placedIds.has(dieId)) latest.current.returnDie(dieId, at);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  latest.current = { legal, commitDie, returnDie, onCell, startDrag };
  // Stable identities so the memoised Base isn't re-rendered just because these were recreated.
  const onCellStable = useCallback((c: Cell) => latest.current.onCell(c), []);
  const onDieDownStable = useCallback((d: number, e: RPointerEvent) => latest.current.startDrag(d, e), []);

  const unplaced = s.dice.filter((d) => !d.cell);
  const selDie = s.dice.find((d) => d.id === sel);
  const selPlaced = sel !== null && placedIds.has(sel);
  const stuck = selDie && !selDie.cell && !s.needsReroll && !hasLegalPlacement(s, selDie.id);
  const focusCol = previewCell && sel !== null ? previewCell[1] : null;
  const dragDie = drag && s.dice.find((d) => d.id === drag.dieId);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col overflow-x-hidden">
      <DamageFlash damage={s.damage} />
      <main className="flex flex-1 flex-col gap-2 px-2 pt-[max(env(safe-area-inset-top),0.5rem)]" style={{ paddingBottom: footerH + 8 }}>
        <Sky s={s} from={selBase} preview={preview} focusCol={focusCol} menu={menu} />
        <Base
          s={s}
          exc={exc}
          digging={exc !== s.excavator}
          selectable={selectable}
          dimmed={false}
          reach={reach}
          onCell={onCellStable}
          onHover={setHover}
          activeRooms={activeRooms}
          movable={movable}
          onDieDown={onDieDownStable}
          draggingId={drag?.dieId ?? null}
        />
      </main>

      {dragDie && (
        // Outer element only follows the finger; the inner one is centred and enlarged. (On one element the
        // scale would also apply to the movement, making the die drift away from the finger.)
        <div ref={ghostRef} className="pointer-events-none fixed z-50 will-change-transform" style={{ left: drag.x, top: drag.y }}>
          <div className="-translate-x-1/2 -translate-y-1/2 scale-110 drop-shadow-xl">
            <DieFace value={dragDie.value} color={dragDie.color} />
          </div>
        </div>
      )}

      <footer ref={footerRef} className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-border bg-background px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <EnergyTrack s={s} />
          <span className="min-w-0 flex-1 text-center text-[10px] uppercase text-muted-foreground">
            {s.phase === "place" &&
              (selPlaced
                    ? "Move this die, or drag it to the tray"
                    : sel !== null
                      ? "Tap or drag to a glowing space"
                      : "Select a die")}
            {s.phase === "resolve" && "Resolve rooms"}
            {s.phase === "placeRobot" && `Place robot (${s.pendingRobotValue})`}
            {(s.phase === "won" || s.phase === "lost") && "Game over"}
          </span>
          <div className="flex shrink-0 gap-1.5">
            <RulesSheet />
            {(s.phase === "place" || s.phase === "resolve" || s.phase === "placeRobot") && (
              <button
                type="button"
                onClick={s.phase === "place" ? undo : undoStep}
                disabled={s.phase === "place" ? !placements.length : !history.length}
                className="flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-xs disabled:opacity-30"
              >
                <Undo2 className="size-3.5" /> Undo
              </button>
            )}
          </div>
        </div>

        {s.phase === "place" && (
          <>
            <div className="flex min-h-14 items-center justify-center gap-3" role={unplaced.length ? "radiogroup" : undefined} aria-label="Dice tray" data-tray>
              {unplaced.length === 0 && (
                <ActionBtn tone="primary" onClick={() => { act(startResolve(s), true); setSel(null); }}>
                  End dice phase · Resolve rooms
                </ActionBtn>
              )}
              {s.dice.filter((d) => !d.cell).map((d, i) => {
                const placed = false;
                // Tumble only on a fresh roll; a die returned from the board just pops back in.
                if (rolled.current.roll !== s.rollId) rolled.current = { roll: s.rollId, ids: new Set() };
                const firstShow = !rolled.current.ids.has(d.id);
                const canPick = placed ? placedIds.has(d.id) : !s.needsReroll;
                return (
                  <button
                    key={placed ? `${d.id}-p` : `${d.id}-${s.rollId}`}
                    type="button"
                    data-die={d.id}
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
                    {firstShow ? <RollingDie value={d.value} color={d.color} delay={i} onDone={() => rolled.current.ids.add(d.id)} /> : <DieFace value={d.value} color={d.color} />}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1.5 empty:hidden [&:not(:empty)]:mt-2">
              {selPlaced && sel !== null ? (
                <ActionBtn tone="muted" onClick={() => returnDie(sel)}>
                  Return die to tray
                </ActionBtn>
              ) : unplaced.length === 0 ? null : s.needsReroll ? (
                <ActionBtn tone="warn" onClick={() => { fresh(reroll(s)); setSel(null); }}>
                  <Dices className="size-4" /> Reroll available dice
                </ActionBtn>
              ) : stuck ? (
                <ActionBtn tone="muted" onClick={() => {
                  const list = [...placements, { dieId: selDie.id, cell: [-1, -1] as Cell }];
                  const next = replay(lockBase, list)!;
                  if (next.needsReroll && next.dice.some((d) => !d.cell)) fresh(reroll(next));
                  else { setS(next); setPlacements(list); }
                  setSel(null);
                }}>
                  No legal space — discard die
                </ActionBtn>
              ) : null}
            </div>
          </>
        )}

        {s.phase === "resolve" && (
          <div className="space-y-1.5">
            <div className="space-y-1">
              {res.length === 0 && <p className="text-xs text-muted-foreground">Nothing left to resolve.</p>}
              {res.map((x) => {
                if (x.dieId !== undefined) {
                  const d = s.dice.find((dd) => dd.id === x.dieId)!;
                  const dist = routeIndex(s, d.cell!) - s.excavator;
                  return (
                    <ResolveRow key={x.key} icon={<Pickaxe className="size-4" />} title={`Dig ${dist} · die ${d.value}`} cost={1} ok={usableNow(x)}
                      onUse={() => act(resolveDig(s, d.id, true))} onSkip={() => act(resolveDig(s, d.id, false))} />
                  );
                }
                const r = x.room!;
                const v = roomValue(s, r);
                return (
                  <ResolveRow key={x.key} icon={<RoomIcons r={r} />}
                    title={`${roomLabel(r)} · value ${v}`} cost={r.cost} ok={usableNow(x)}
                    onUse={() => act(resolveRoom(s, r.id, true))} onSkip={() => act(skipRobots(s, r.id))} />
                );
              })}
            </div>
            <ActionBtn tone={nothingUsable ? "primary" : "muted"} onClick={() => { fresh(endRound(s)); setSel(null); }}>
              End round · Mothership descends
            </ActionBtn>
          </div>
        )}

        {s.phase === "placeRobot" && <ActionBtn tone="muted" onClick={() => act(placeRobot(s, null))}>Discard robot</ActionBtn>}

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
        "flex h-11 w-full flex-1 items-center justify-center gap-2 rounded-sm border font-display text-xs font-bold uppercase tracking-wide transition-all disabled:opacity-40",
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
