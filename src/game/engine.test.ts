import { describe, expect, it } from "vitest";
import { BOARDS, composeBoard, setupLevel } from "./data";
import {
  board,
  pendingEnergy,
  canPlace,
  isExcavated,
  roomUsable,
  canPlaceRobot,
  replay,
  endRound,
  newGame,
  placeDie,
  researchAdvance,
  resolveDig,
  resolveRoom,
  shootDown,
  type GameState,
} from "./engine";

const fixed = (v: number) => () => (v - 1) / 6;
const game = (): GameState => {
  const s = newGame(fixed(3));
  return s;
};

describe("dice placement", () => {
  it("only one die per column", () => {
    let s = game();
    s = placeDie(s, 0, [1, 0]);
    expect(canPlace(s, 1, [2, 0])).toBe("Column already has a die");
  });

  it("ships in the column descend by the die value", () => {
    let s = game();
    s.dice[0]!.value = 4;
    s = placeDie(s, 0, [1, 2]); // fighter room, no ship reduction
    expect(s.ships.find((x) => x.id === 2)!.pos).toBe(3);
  });

  it("dig room makes ships move one space less", () => {
    let s = game();
    s.dice[0]!.value = 1;
    s = placeDie(s, 0, [0, 0]);
    expect(s.ships.find((x) => x.id === 0)!.pos).toBe(-1);
  });

  it("placing a dark die forces a reroll of remaining dice", () => {
    let s = game();
    expect(s.dice[3]?.color).toBe("grey");
    s = placeDie(s, 3, [1, 0]);
    expect(s.needsReroll).toBe(true);
    expect(canPlace(s, 0, [1, 1])).toBe("Reroll first");
  });

  it("only one die may go on unexcavated spaces per round", () => {
    let s = game();
    s = placeDie(s, 0, [3, 4]);
    expect(canPlace(s, 1, [3, 3])).toBe("Only one excavator die per round");
  });
});

describe("rooms", () => {
  it("energy is capped at 7", () => {
    let s = game();
    s.energy = 6;
    s.dice[0]!.value = 6;
    s.dice[1]!.value = 6;
    s = placeDie(s, 0, [2, 1]);
    s = placeDie(s, 1, [2, 2]);
    s = resolveRoom(s, "R2b", true);
    expect(s.energy).toBe(7);
  });

  it("research advances only when value covers the sum of spaces", () => {
    expect(researchAdvance(0, 2)).toBe(0);
    expect(researchAdvance(0, 3)).toBe(1);
    expect(researchAdvance(1, 4)).toBe(2); // 1 then needs 4 more
    expect(researchAdvance(1, 5)).toBe(3);
  });

  it("fighters shoot ships on explosions with number <= value", () => {
    const s = game();
    s.ships[1]!.pos = 2; // column 1, row 2 has explosion 1
    s.ships[0]!.pos = 3; // column 0, row 3 has explosion 2
    expect(shootDown(s, 1)).toBe(1);
    expect(s.ships[0]!.pos).toBe(3);
  });

  it("excavator costs 1 energy and needs value >= distance", () => {
    let s = game();
    s.dice[0]!.value = 2;
    s = placeDie(s, 0, [3, 3]); // route distance 2
    s = resolveDig(s, 0, true);
    expect(s.excavator).toBe(2);
    expect(s.energy).toBe(1);
  });
});

describe("damage and end", () => {
  it("a ship reaching the base deals 1 damage and returns", () => {
    let s = game();
    s.ships[4]!.pos = 13;
    s.dice[0]!.value = 3;
    s = placeDie(s, 0, [1, 4]);
    expect(s.damage).toBe(1);
    expect(s.ships[4]!.pos).toBe(null);
  });

  it("5 damage loses the game", () => {
    const s = game();
    s.damage = 4;
    s.ships[4]!.pos = 14;
    const r = placeDie(s, 0, [1, 4]);
    expect(r.phase).toBe("lost");
  });

  it("mothership descends one row each round and respawns ships", () => {
    let s = game();
    s.phase = "resolve";
    s = endRound(s, fixed(2));
    expect(s.mothership).toBe(1);
    expect(s.ships.filter((x) => x.pos === 0).length).toBe(5);
  });

  it("mothership covering the skull loses", () => {
    let s = game();
    s.mothership = 11;
    s.phase = "resolve";
    s = endRound(s);
    expect(s.phase).toBe("lost");
  });
});

describe("excavator limits", () => {
  it("a die cannot be placed further along the route than its value", () => {
    const s = game(); // all dice show 3
    expect(canPlace(s, 0, [3, 1])).toBe("Too far for the excavator"); // distance 4
    expect(canPlace(s, 0, [3, 2])).toBe(null); // distance 3
  });
  it("the excavator's destination stays unexcavated and its room stays locked", () => {
    let s = game();
    s = placeDie(s, 0, [3, 4]);
    s = resolveDig(s, 0, true);
    expect(isExcavated(s, [3, 4])).toBe(false);
    const room = board(s).rooms.find((r) => r.id === "R3d");
    expect(room && roomUsable(s, room)).toBe(false);
    expect(canPlaceRobot(s, [3, 4])).toBe(false);
    s.dice = s.dice.map((d) => ({ ...d, cell: null }));
    expect(canPlace(s, 0, [3, 4])).toBe("Excavator occupies this space");
    s.excavator = 2;
    expect(isExcavated(s, [3, 4])).toBe(true);
    expect(room && roomUsable(s, room)).toBe(true);
  });
  it("the starting excavator space is occupied, not excavated", () => {
    const s = game();
    expect(isExcavated(s, [2, 4])).toBe(false);
    expect(canPlace(s, 0, [2, 4])).toBe("Excavator occupies this space");
  });
  it("ordinary dice are white and do not cause rerolls", () => {
    const s = game();
    expect(s.dice.slice(0, 3).map((d) => d.color)).toEqual(["white", "white", "white"]);
    expect(placeDie(s, 0, [1, 0]).needsReroll).toBe(false);
  });
});

describe("hard side", () => {
  const hard = () => newGame(fixed(3), "hard");
  it("starts with two red ships waiting on the mothership", () => {
    const s = hard();
    expect(s.ships.filter((x) => x.color === "red" && !x.destroyed && x.pos === null).length).toBe(2);
  });
  it("excavator route goes down the tall lab, exits left, then steps back up", () => {
    const r = board(hard()).route;
    const i = r.findIndex((c) => c[0] === 4 && c[1] === 4);
    expect(r.slice(i, i + 4)).toEqual([[4, 4], [5, 4], [5, 3], [4, 3]]);
  });
  it("mothership reaching the hard skull row loses", () => {
    const s = hard();
    s.mothership = 10;
    s.phase = "resolve";
    expect(endRound(s).phase).toBe("lost");
  });
});

describe("mixed card setups", () => {
  it("all-easy and all-hard setups match the full easy and hard boards", () => {
    expect(composeBoard("eeeeeeee")).toEqual(BOARDS.easy);
    expect(composeBoard("hhhhhhhh")).toEqual(BOARDS.hard);
  });
  it("only the mothership card on hard gives 2 red ships and easy everything else", () => {
    const s = newGame(fixed(3), "heeeeeee");
    expect(s.ships.filter((x) => x.color === "red" && !x.destroyed).length).toBe(2);
    expect(board(s).skullRow).toBe(11);
  });
  it("the hard clouds card moves the skull to row 10", () => {
    expect(composeBoard("eeeheeee").skullRow).toBe(10);
  });
  it("every combination's dig path is a connected walk through distinct spaces", () => {
    for (let m = 0; m < 4; m++) {
      const r = composeBoard(`eeeee${m & 1 ? "h" : "e"}${m & 2 ? "h" : "e"}e`).route;
      expect(new Set(r.map((c) => c.join())).size).toBe(r.length);
      for (let i = 1; i < r.length; i++) expect(Math.abs(r[i]![0] - r[i - 1]![0]) + Math.abs(r[i]![1] - r[i - 1]![1])).toBe(1);
    }
  });
  it("level counts hard cards", () => {
    expect(setupLevel("hheeeehe")).toBe(3);
  });
});

describe("upcoming energy", () => {
  it("counts a filled generator's value including its modifier", () => {
    const s = game();
    s.dice[0]!.value = 4;
    s.dice[0]!.cell = [1, 0]; // easy generator, -1
    expect(pendingEnergy(s)).toBe(3);
  });
  it("is zero with no generator filled", () => {
    expect(pendingEnergy(game())).toBe(0);
  });
});

describe("rearranging dice", () => {
  it("replaying placements without a die restores its column", () => {
    const base = game();
    const s = replay(base, [{ dieId: 0, cell: [1, 2] }])!;
    expect(s.ships[2]!.pos).toBe(2);
    const r = replay(base, [])!;
    expect(r.ships[2]!.pos).toBe(-1);
  });
});
