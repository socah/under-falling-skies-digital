import { describe, expect, it } from "vitest";
import {
  canPlace,
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

  it("placing a white die forces a reroll of remaining dice", () => {
    let s = game();
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
