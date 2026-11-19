import { BOARDS, composeBoard, normalizeSetup, setupLevel, COLS, DAMAGE_ROW, MAX_DAMAGE, MAX_ENERGY, START_ENERGY, type Board, type Difficulty, type Room } from "./data";

export type Rng = () => number;
export type Cell = [number, number];
export interface Die {
  id: number;
  color: "grey" | "white";
  value: number;
  cell: Cell | null;
  resolved: boolean;
}
export interface Ship {
  id: number;
  color: "green" | "red";
  col: number;
  pos: number | null; // null = waiting on mothership card; M-1 = starting spot
  destroyed?: boolean;
  /** Why the ship last left the sky, so the UI can animate it: shot down, crashed into the base, or taken back by the descending mothership. */
  exit?: "shot" | "crash" | "recalled";
}
export interface Robot {
  id: number;
  value: number;
  cell: Cell;
  used: boolean;
  fresh: boolean;
}
export type Phase = "place" | "resolve" | "placeRobot" | "won" | "lost";
export interface GameState {
  difficulty: Difficulty;
  round: number;
  phase: Phase;
  mothership: number;
  damage: number;
  energy: number;
  research: number;
  excavator: number; // index into route
  dice: Die[];
  ships: Ship[];
  robots: Robot[];
  needsReroll: boolean;
  pendingRobotValue: number | null;
  log: string[];
  rollId: number;
  endReason?: string;
}

export const board = (s: { difficulty: Difficulty }): Board => composeBoard(s.difficulty);
export const roll = (rng: Rng) => 1 + Math.floor(rng() * 6);
const eq = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
export const roomAt = (s: GameState, cell: Cell): Room | undefined => board(s).rooms.find((r) => r.cells.some((c) => eq(c, cell)));
export const routeIndex = (s: GameState, cell: Cell) => board(s).route.findIndex((c) => eq(c, cell));

export function isExcavated(s: GameState, cell: Cell) {
  const i = routeIndex(s, cell);
  return i === -1 ? true : i < s.excavator;
}
export function roomUsable(s: GameState, r: Room) {
  return r.cells.every((c) => isExcavated(s, c));
}

function newDice(rng: Rng): Die[] {
  return [0, 1, 2, 3, 4].map((i) => ({ id: i, color: i < 3 ? "white" : "grey", value: roll(rng), cell: null, resolved: false }));
}

export function newGame(rng: Rng = Math.random, difficulty: Difficulty = "easy"): GameState {
  difficulty = normalizeSetup(difficulty);
  const red = composeBoard(difficulty).startingRed;
  return {
    difficulty,
    round: 1,
    phase: "place",
    mothership: 0,
    damage: 0,
    energy: START_ENERGY,
    research: 0,
    excavator: 0,
    dice: newDice(rng),
    ships: [
      ...[0, 1, 2, 3, 4].map((c) => ({ id: c, color: "green" as const, col: c, pos: -1 })),
      { id: 5, color: "red", col: 0, pos: null, destroyed: red < 1 },
      { id: 6, color: "red", col: 0, pos: null, destroyed: red < 2 },
    ],
    robots: [],
    needsReroll: false,
    pendingRobotValue: null,
    log: [`Round 1 (level ${setupLevel(difficulty)}) — dice rolled.`],
    rollId: 1,
  };
}

const clone = (s: GameState): GameState => structuredClone(s);
const occupied = (s: GameState, cell: Cell) => s.dice.some((d) => d.cell && eq(d.cell, cell)) || s.robots.some((r) => eq(r.cell, cell));

/** Is this placement an excavator move (die on a not-yet-excavated space)? */
export const isDigPlacement = (s: GameState, cell: Cell) => !isExcavated(s, cell);

export function canPlace(s: GameState, dieId: number, cell: Cell): string | null {
  if (s.phase !== "place") return "Not in placement phase";
  if (s.needsReroll) return "Reroll first";
  const die = s.dice.find((d) => d.id === dieId);
  if (!die || die.cell) return "Die unavailable";
  if (routeIndex(s, cell) === s.excavator) return "Excavator occupies this space";
  if (occupied(s, cell)) return "Space occupied";
  if (s.dice.some((d) => d.cell && d.cell[1] === cell[1])) return "Column already has a die";
  if (isExcavated(s, cell)) {
    if (!roomAt(s, cell)) return "Empty tunnel";
    return null;
  }
  if (s.dice.some((d) => d.cell && d.cell[0] >= 0 && isDigPlacement(s, d.cell))) return "Only one excavator die per round";
  if (routeIndex(s, cell) - s.excavator > die.value) return "Too far for the excavator";
  return null;
}

/** Undug route spaces this die could legally excavate to. */
export function digTargets(s: GameState, dieId: number): Cell[] {
  return board(s).route.filter((c) => isDigPlacement(s, c) && !canPlace(s, dieId, c));
}

/** Movement a die causes in its column (dig rooms reduce it by 1). */
export function shipMove(s: GameState, die: { value: number }, cell: Cell) {
  const r = roomAt(s, cell);
  const usableDig = r?.parts[0] === "dig" && isExcavated(s, cell);
  return Math.max(0, die.value - (usableDig ? 1 : 0));
}

function advanceMothership(s: GameState) {
  const old = s.mothership;
  s.mothership = old + 1;
  for (const sh of s.ships) {
    if (sh.pos === old) {
      sh.pos = null;
      sh.exit = "recalled";
    } else if (sh.pos === old - 1) sh.pos = old;
  }
  s.log.push(`Mothership descends to row ${s.mothership}.`);
  if (s.mothership > board(s).skullRow) lose(s, "The mothership reached the skull.");
}

function lose(s: GameState, why: string) {
  if (s.phase === "won" || s.phase === "lost") return;
  s.phase = "lost";
  s.endReason = why;
  s.log.push(`DEFEAT — ${why}`);
}
function takeDamage(s: GameState) {
  s.damage++;
  s.log.push(`Base hit! Damage ${s.damage}/${MAX_DAMAGE}.`);
  if (s.damage >= MAX_DAMAGE) lose(s, "Your base was destroyed.");
}

/** Move all ships in a column by n spaces, resolving landing effects. */
export function moveColumn(s: GameState, col: number, n: number) {
  if (n <= 0) return;
  const sky = board(s).sky;
  const movers = s.ships.filter((sh) => sh.col === col && sh.pos !== null);
  for (const sh of movers) {
    if (sh.pos === null) continue;
    const target = sh.pos + n;
    if (target >= DAMAGE_ROW) {
      sh.pos = null;
      sh.exit = "crash";
      takeDamage(s);
      continue;
    }
    sh.pos = target;
    const icon = target >= 0 ? sky[target]![col] : null;
    if (!icon) continue;
    if (icon.t === "L" || icon.t === "R") {
      const nc = col + (icon.t === "L" ? -1 : 1);
      if (nc >= 0 && nc < COLS && !s.ships.some((o) => o.col === nc && o.pos === target)) sh.col = nc;
    } else if (icon.t === "saucer") advanceMothership(s);
  }
}

export function placeDie(prev: GameState, dieId: number, cell: Cell): GameState {
  const err = canPlace(prev, dieId, cell);
  if (err) throw new Error(err);
  const s = clone(prev);
  const die = s.dice.find((d) => d.id === dieId)!;
  const n = shipMove(s, die, cell);
  die.cell = cell;
  moveColumn(s, cell[1], n);
  s.log.push(`Placed ${die.color} ${die.value} in column ${cell[1] + 1}; ships move ${n}.`);
  if (s.phase !== "place") return s;
  const left = s.dice.filter((d) => !d.cell);
  if (die.color === "grey" && left.length > 0) s.needsReroll = true;
  return s;
}

/** Rebuild a state by replaying placements from a locked snapshot (used to rearrange dice before a reroll). */
export function replay(base: GameState, placements: { dieId: number; cell: Cell }[]): GameState | null {
  let s = base;
  for (const p of placements) {
    if (p.cell[0] < 0) {
      s = discardDie(s, p.dieId);
      continue;
    }
    if (canPlace(s, p.dieId, p.cell)) return null;
    s = placeDie(s, p.dieId, p.cell);
  }
  return s;
}

export function discardDie(prev: GameState, dieId: number): GameState {
  const s = clone(prev);
  const die = s.dice.find((d) => d.id === dieId);
  if (!die || die.cell) return s;
  die.cell = [-1, -1];
  die.resolved = true;
  return s;
}

export function startResolve(prev: GameState): GameState {
  const s = clone(prev);
  if (s.phase !== "place" || s.dice.some((d) => !d.cell)) return s;
  s.phase = "resolve";
  // Rooms that aren't completely filled have no effect: skip them right away.
  for (const r of board(s).rooms) {
    if (r.parts[0] === "dig" || !roomUsable(s, r)) continue;
    const c = roomContents(s, r);
    if (c.full || !c.dice.length) continue;
    for (const d of c.dice) d.resolved = true;
    s.log.push(`${r.id}: not every space filled — skipped.`);
  }
  s.log.push("Resolve your rooms in any order.");
  return s;
}

export function hasLegalPlacement(s: GameState, dieId: number) {
  for (let r = 0; r < 6; r++) for (let c = 0; c < COLS; c++) if (!canPlace(s, dieId, [r, c])) return true;
  return false;
}

export function reroll(prev: GameState, rng: Rng = Math.random): GameState {
  const s = clone(prev);
  for (const d of s.dice) if (!d.cell) d.value = roll(rng);
  s.needsReroll = false;
  s.rollId++;
  s.log.push("Remaining dice rerolled.");
  return s;
}

export function roomContents(s: GameState, r: Room) {
  const dice = s.dice.filter((d) => d.cell && !d.resolved && r.cells.some((c) => eq(c, d.cell!)));
  const robots = s.robots.filter((rb) => !rb.used && !rb.fresh && r.cells.some((c) => eq(c, rb.cell)));
  return { dice, robots, full: dice.length + robots.length === r.cells.length };
}

export function researchAdvance(pos: number, value: number, track: number[] = BOARDS.easy.research) {
  let p = pos;
  let sum = 0;
  while (p + 1 < track.length && sum + track[p + 1]! <= value) {
    sum += track[p + 1]!;
    p++;
  }
  return p;
}

export function shootDown(s: GameState, value: number) {
  const sky = board(s).sky;
  let n = 0;
  for (const sh of s.ships) {
    if (sh.pos === null || sh.pos < 0 || sh.pos >= DAMAGE_ROW) continue;
    const icon = sky[sh.pos]![sh.col];
    if (icon?.t === "exp" && icon.v <= value) {
      sh.pos = null;
      sh.exit = "shot";
      if (sh.color === "red") sh.destroyed = true;
      n++;
    }
  }
  return n;
}

export function resolvables(s: GameState) {
  const out: { key: string; room?: Room; dieId?: number }[] = [];
  for (const r of board(s).rooms) {
    if (r.parts[0] === "dig" || !roomUsable(s, r)) continue;
    const c = roomContents(s, r);
    // Incomplete rooms can't do anything, so they're never offered.
    if (c.full && c.dice.length + c.robots.length > 0) out.push({ key: r.id, room: r });
  }
  for (const d of s.dice) if (d.cell && d.cell[0] >= 0 && !d.resolved && isDigPlacement(s, d.cell)) out.push({ key: `dig${d.id}`, dieId: d.id });
  return out;
}

/** Energy that filled, unresolved generator rooms will add this round (before other room costs). */
export function pendingEnergy(s: GameState) {
  let n = 0;
  for (const r of board(s).rooms) {
    if (!r.parts.includes("energy")) continue;
    const { dice, robots, full } = roomContents(s, r);
    if (!full || !dice.length && !robots.length) continue;
    const v = dice.reduce((a, d) => a + d.value, 0) + robots.reduce((a, b) => a + b.value, 0) + r.mod;
    if (v > 0) n += v;
  }
  return n;
}

const findRoom = (s: GameState, id: string) => board(s).rooms.find((x) => x.id === id)!;

export function resolveRoom(prev: GameState, roomId: string, use: boolean): GameState {
  const s = clone(prev);
  const r = findRoom(s, roomId);
  const { dice, robots, full } = roomContents(s, r);
  const finish = () => {
    for (const d of dice) d.resolved = true;
  };
  if (!use || !full || s.energy < r.cost) {
    if (use && !full) s.log.push(`${roomId}: not every space filled — no effect.`);
    if (use && full && s.energy < r.cost) s.log.push(`${roomId}: not enough energy.`);
    finish();
    return s;
  }
  s.energy -= r.cost;
  const value = dice.reduce((a, d) => a + d.value, 0) + robots.reduce((a, b) => a + b.value, 0) + r.mod;
  finish();
  for (const rb of robots) {
    rb.used = true;
    if (rb.value <= 1) s.robots = s.robots.filter((x) => x.id !== rb.id);
    else rb.value -= 1;
  }
  const track = board(s).research;
  for (const k of r.parts) {
    if (value <= 0) break;
    if (k === "energy") {
      s.energy = Math.min(MAX_ENERGY, s.energy + value);
      s.log.push(`Energy +${value} → ${s.energy}.`);
    } else if (k === "fighter") {
      const n = shootDown(s, value);
      s.log.push(`Fighters (${value}) shot down ${n} ship${n === 1 ? "" : "s"}.`);
    } else if (k === "research") {
      const before = s.research;
      s.research = researchAdvance(s.research, value, track);
      s.log.push(`Research (${value}) advanced ${s.research - before}.`);
      if (s.research === track.length - 1) {
        s.phase = "won";
        s.endReason = "Your weapon destroyed the mothership!";
        s.log.push("VICTORY!");
      }
    } else if (k === "robot") {
      if (s.robots.length < 2) {
        s.pendingRobotValue = Math.min(6, value);
        if (s.phase !== "won") s.phase = "placeRobot";
      } else s.log.push("No robot dice left.");
    }
  }
  if (value <= 0) s.log.push(`${roomId}: value ${value} — no effect.`);
  return s;
}

export function skipRobots(prev: GameState, roomId: string): GameState {
  const s = clone(prev);
  const r = findRoom(s, roomId);
  const { dice } = roomContents(s, r);
  for (const d of dice) d.resolved = true;
  s.robots.forEach((rb) => {
    if (r.cells.some((c) => eq(c, rb.cell))) rb.fresh = true;
  });
  return s;
}

export function canPlaceRobot(s: GameState, cell: Cell) {
  const r = roomAt(s, cell);
  return !!r && roomUsable(s, r) && !s.robots.some((rb) => eq(rb.cell, cell)) && !s.dice.some((d) => d.cell && !d.resolved && eq(d.cell, cell));
}

export function placeRobot(prev: GameState, cell: Cell | null): GameState {
  const s = clone(prev);
  if (cell && canPlaceRobot(s, cell) && s.pendingRobotValue) {
    s.robots.push({ id: (Date.now() % 100000) + s.robots.length, value: s.pendingRobotValue, cell, used: false, fresh: true });
    s.log.push(`Robot (${s.pendingRobotValue}) built.`);
  }
  s.pendingRobotValue = null;
  if (s.phase === "placeRobot") s.phase = "resolve";
  return s;
}

export function resolveDig(prev: GameState, dieId: number, use: boolean): GameState {
  const s = clone(prev);
  const d = s.dice.find((x) => x.id === dieId)!;
  d.resolved = true;
  if (!use || !d.cell) return s;
  if (s.energy < 1) {
    s.log.push("Excavator: not enough energy.");
    return s;
  }
  s.energy -= 1;
  const dist = routeIndex(s, d.cell) - s.excavator;
  if (d.value >= dist) {
    s.excavator = routeIndex(s, d.cell);
    s.log.push(`Excavator dug ${dist} space${dist === 1 ? "" : "s"}.`);
  } else s.log.push(`Excavator: die too low (needed ${dist}).`);
  return s;
}

export function spawnShips(s: GameState) {
  const start = s.mothership - 1;
  const pool = s.ships
    .filter((sh) => sh.pos === null && !sh.destroyed)
    .sort((a, b) => (a.color === b.color ? 0 : a.color === "green" ? -1 : 1));
  for (const sh of pool) {
    const free = [0, 1, 2, 3, 4].filter((c) => !s.ships.some((o) => o.col === c && o.pos === start));
    if (free.length === 0) break;
    const empty = free.filter((c) => !s.ships.some((o) => o.col === c && o.pos !== null));
    let col: number;
    if (empty.length) col = empty[0]!;
    else {
      const gap = (c: number) => Math.min(...s.ships.filter((o) => o.col === c && o.pos !== null).map((o) => o.pos!)) - start;
      col = free.reduce((best, c) => (gap(c) > gap(best) ? c : best), free[0]!);
    }
    sh.col = col;
    sh.pos = start;
  }
}

export function endRound(prev: GameState, rng: Rng = Math.random): GameState {
  const s = clone(prev);
  if (s.phase !== "resolve") return s;
  for (const d of s.dice) d.resolved = true;
  const eff = board(s).msEffects[s.mothership];
  if (eff) {
    if (eff.t === "damage") takeDamage(s);
    else if (eff.t === "exc") {
      s.excavator = Math.max(0, s.excavator - eff.n);
      s.robots = s.robots.filter((rb) => isExcavated(s, rb.cell));
      s.log.push(`Mothership: excavator pushed back ${eff.n}.`);
    } else if (eff.t === "research") {
      s.research = Math.max(0, s.research - eff.n);
      s.log.push(`Mothership: research set back ${eff.n}.`);
    } else if (eff.t === "red") {
      const red = s.ships.find((sh) => sh.color === "red" && sh.destroyed && sh.pos === null);
      if (red) {
        red.destroyed = false;
        s.log.push("Mothership: a red ship joins the fleet.");
      }
    }
  }
  if ((s.phase as string) === "lost") return s;
  advanceMothership(s);
  if ((s.phase as string) === "lost") return s;
  spawnShips(s);
  for (const rb of s.robots) {
    rb.used = false;
    rb.fresh = false;
  }
  s.round++;
  s.dice = newDice(rng);
  s.rollId++;
  s.phase = "place";
  s.log.push(`Round ${s.round} — dice rolled.`);
  return s;
}
