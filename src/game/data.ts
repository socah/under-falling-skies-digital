// Board data transcribed from the easy sides of the Under Falling Skies 9-card PnP.
export type SkyIcon =
  | { t: "exp"; v: number }
  | { t: "L" }
  | { t: "R" }
  | { t: "saucer" }
  | null;

const _ = null;
const E = (v: number): SkyIcon => ({ t: "exp", v });
const L: SkyIcon = { t: "L" };
const R: SkyIcon = { t: "R" };
const S: SkyIcon = { t: "saucer" };

/** 15 sky rows (index 0 = just under the mothership). Row 15 is the city/damage row. */
export const SKY: SkyIcon[][] = [
  [_, _, _, _, _],
  [_, _, _, L, _],
  [_, E(1), R, _, _],
  [E(2), R, _, _, S],
  [_, _, L, R, _],
  [_, L, S, E(2), _],
  [E(3), S, R, _, E(4)],
  [R, _, E(3), _, L],
  [S, E(6), _, L, _],
  [R, _, E(3), S, E(2)],
  [_, R, _, E(5), _],
  [_, L, S, _, L],
  [E(5), _, L, E(4), S],
  [_, E(3), E(5), R, _],
  [_, _, _, S, E(6)],
];
export const DAMAGE_ROW = SKY.length; // 15
export const COLS = 5;

export type MsEffect =
  | { t: "exc"; n: number }
  | { t: "research"; n: number }
  | { t: "red" }
  | { t: "damage" }
  | { t: "skull" }
  | null;

/** Mothership-track effect printed beside each sky row. */
export const MS_EFFECTS: MsEffect[] = [
  null,
  { t: "exc", n: 1 },
  { t: "red" },
  { t: "research", n: 1 },
  { t: "exc", n: 1 },
  { t: "exc", n: 2 },
  { t: "research", n: 2 },
  { t: "red" },
  { t: "exc", n: 1 },
  { t: "damage" },
  null,
  { t: "skull" },
];
export const SKULL_ROW = 11;

export type RoomKind = "dig" | "energy" | "robot" | "fighter" | "research" | "energyFighter";
export interface Room {
  id: string;
  kind: RoomKind;
  mod: number;
  cost: number;
  cells: [number, number][]; // [row, col]
}

const room = (id: string, kind: RoomKind, mod: number, cost: number, cells: [number, number][]): Room => ({
  id,
  kind,
  mod,
  cost,
  cells,
});

export const ROOMS: Room[] = [
  ...[0, 1, 2, 3, 4].map((c) => room(`X${c}`, "dig", 0, 0, [[0, c]])),
  room("R1a", "energy", -1, 0, [[1, 0]]),
  room("R1b", "robot", -1, 1, [[1, 1]]),
  room("R1c", "fighter", -1, 1, [[1, 2]]),
  room("R1e", "research", -1, 1, [[1, 4]]),
  room("R2a", "research", 0, 1, [[2, 0]]),
  room("R2b", "energy", 0, 0, [[2, 1], [2, 2]]),
  room("R2c", "fighter", 0, 2, [[2, 3]]),
  room("R3a", "robot", 0, 2, [[3, 0]]),
  room("R3b", "fighter", 1, 2, [[3, 1]]),
  room("R3c", "research", 0, 1, [[3, 2], [3, 3]]),
  room("R3d", "energy", 0, 0, [[3, 4]]),
  room("R4a", "energyFighter", -3, 0, [[4, 0], [4, 1]]),
  room("R4b", "robot", 0, 1, [[4, 3]]),
  room("R4c", "fighter", 0, 1, [[4, 4]]),
  room("R5a", "research", 0, 1, [[5, 1], [5, 2], [5, 3]]),
];
export const BASE_ROWS = 6;
export const TUNNELS: [number, number][] = [
  [1, 3],
  [2, 4],
  [4, 2],
  [5, 0],
  [5, 4],
];

/** Excavator route; index 0 is the excavator's starting tunnel. */
export const ROUTE: [number, number][] = [
  [2, 4],
  [3, 4], [3, 3], [3, 2], [3, 1], [3, 0],
  [4, 0], [4, 1], [4, 2], [4, 3], [4, 4],
  [5, 4], [5, 3], [5, 2], [5, 1], [5, 0],
];

/** Research track values; index 0 is the start, last index wins. */
export const RESEARCH = [0, 3, 1, 4, 2, 3, 2, 6, 2, 1, 4, 7, 4, 2, 12];
export const MAX_ENERGY = 7;
export const START_ENERGY = 2;
export const MAX_DAMAGE = 5; // 5th damage reaches the skull
