// Board data transcribed from the Under Falling Skies 9-card PnP (easy and hard sides).
export type SkyIcon = { t: "exp"; v: number } | { t: "L" } | { t: "R" } | { t: "saucer" } | null;
export type Difficulty = "easy" | "hard";

const _ = null;
const E = (v: number): SkyIcon => ({ t: "exp", v });
const L: SkyIcon = { t: "L" };
const R: SkyIcon = { t: "R" };
const S: SkyIcon = { t: "saucer" };

export type MsEffect =
  | { t: "exc"; n: number }
  | { t: "research"; n: number }
  | { t: "red" }
  | { t: "damage" }
  | { t: "skull" }
  | null;

export type RoomPart = "dig" | "energy" | "robot" | "fighter" | "research";
export interface Room {
  id: string;
  parts: RoomPart[];
  mod: number;
  cost: number;
  cells: [number, number][]; // [row, col]
}

export interface Board {
  sky: SkyIcon[][];
  msEffects: MsEffect[];
  skullRow: number;
  rooms: Room[];
  /** Excavator route; index 0 is the excavator's starting tunnel. */
  route: [number, number][];
  research: number[];
  /** Red ships waiting on the mothership card at the start. */
  startingRed: number;
}

const room = (id: string, parts: RoomPart[], mod: number, cost: number, cells: [number, number][]): Room => ({ id, parts, mod, cost, cells });
const digRow = () => [0, 1, 2, 3, 4].map((c) => room(`X${c}`, ["dig"], 0, 0, [[0, c]]));

export const COLS = 5;
export const DAMAGE_ROW = 15;
export const BASE_ROWS = 6;
export const MAX_ENERGY = 7;
export const START_ENERGY = 2;
export const MAX_DAMAGE = 5;

const EASY: Board = {
  sky: [
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
  ],
  msEffects: [
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
  ],
  skullRow: 11,
  rooms: [
    ...digRow(),
    room("R1a", ["energy"], -1, 0, [[1, 0]]),
    room("R1b", ["robot"], -1, 1, [[1, 1]]),
    room("R1c", ["fighter"], -1, 1, [[1, 2]]),
    room("R1e", ["research"], -1, 1, [[1, 4]]),
    room("R2a", ["research"], 0, 1, [[2, 0]]),
    room("R2b", ["energy"], 0, 0, [[2, 1], [2, 2]]),
    room("R2c", ["fighter"], 0, 2, [[2, 3]]),
    room("R3a", ["robot"], 0, 2, [[3, 0]]),
    room("R3b", ["fighter"], 1, 2, [[3, 1]]),
    room("R3c", ["research"], 0, 1, [[3, 2], [3, 3]]),
    room("R3d", ["energy"], 0, 0, [[3, 4]]),
    room("R4a", ["energy", "fighter"], -3, 0, [[4, 0], [4, 1]]),
    room("R4b", ["robot"], 0, 1, [[4, 3]]),
    room("R4c", ["fighter"], 0, 1, [[4, 4]]),
    room("R5a", ["research"], 0, 1, [[5, 1], [5, 2], [5, 3]]),
  ],
  route: [
    [2, 4],
    [3, 4], [3, 3], [3, 2], [3, 1], [3, 0],
    [4, 0], [4, 1], [4, 2], [4, 3], [4, 4],
    [5, 4], [5, 3], [5, 2], [5, 1], [5, 0],
  ],
  research: [0, 3, 1, 4, 2, 3, 2, 6, 2, 1, 4, 7, 4, 2, 12],
  startingRed: 0,
};

const HARD: Board = {
  sky: [
    [R, _, _, _, _],
    [_, _, R, _, _],
    [_, L, _, S, E(2)],
    [S, E(3), _, _, L],
    [S, _, L, _, S],
    [_, S, _, E(5), E(4)],
    [R, _, E(4), R, _],
    [E(3), R, _, E(7), _],
    [_, L, S, _, L],
    [S, E(5), R, _, _],
    [R, _, _, S, _],
    [E(6), _, _, L, _],
    [_, E(5), S, S, _],
    [S, _, L, E(5), S],
    [E(7), S, E(5), S, E(6)],
  ],
  msEffects: [
    { t: "exc", n: 2 },
    { t: "exc", n: 2 },
    { t: "red" },
    { t: "exc", n: 1 },
    { t: "red" },
    { t: "research", n: 2 },
    { t: "research", n: 2 },
    { t: "exc", n: 1 },
    { t: "damage" },
    { t: "research", n: 1 },
    { t: "skull" },
  ],
  skullRow: 10,
  rooms: [
    ...digRow(),
    room("H1a", ["energy"], -2, 0, [[1, 0], [1, 1]]),
    room("H1b", ["fighter"], 0, 2, [[1, 2]]),
    room("H1c", ["research"], -2, 0, [[1, 3]]),
    room("H2a", ["fighter"], 1, 2, [[2, 0]]),
    room("H2b", ["research"], 1, 2, [[2, 1]]),
    room("H2c", ["energy", "robot"], -6, 0, [[2, 3], [2, 4]]),
    room("H3a", ["robot"], -1, 0, [[3, 0]]),
    room("H3b", ["research", "fighter"], -3, 3, [[3, 1], [3, 2]]),
    room("H3c", ["energy"], -1, 0, [[3, 3]]),
    room("H3d", ["fighter"], -1, 0, [[3, 4]]),
    room("H4a", ["fighter"], 0, 0, [[4, 1], [4, 2]]),
    room("H4b", ["robot"], 0, 2, [[4, 3]]),
    room("H4c", ["research"], 1, 1, [[4, 4], [5, 4]]),
    room("H5a", ["research"], 2, 3, [[5, 0], [5, 1]]),
  ],
  // Zigzag, except the tall lab: down through it, exit left, step back up, continue.
  route: [
    [1, 4],
    [2, 4], [2, 3], [2, 2], [2, 1], [2, 0],
    [3, 0], [3, 1], [3, 2], [3, 3], [3, 4],
    [4, 4], [5, 4], [5, 3], [4, 3], [4, 2], [4, 1], [4, 0],
    [5, 0], [5, 1],
  ],
  research: [0, 2, 2, 5, 1, 4, 5, 2, 2, 7, 1, 7, 3, 4, 12],
  startingRed: 2,
};

export const BOARDS: Record<Difficulty, Board> = { easy: EASY, hard: HARD };
