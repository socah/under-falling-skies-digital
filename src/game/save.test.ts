import { beforeEach, describe, expect, it } from "vitest";
import { newGame, placeDie } from "./engine";
import { SAVE_VERSION, clearSave, loadSave, writeSave } from "./save";

const fixed = (v: number) => () => (v - 1) / 6;

describe("saved game", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the game, placements and history", () => {
    const start = newGame(fixed(3), "eehheeee");
    const s = placeDie(start, 0, [1, 2]);
    writeSave({ s, lockBase: start, placements: [{ dieId: 0, cell: [1, 2] }], history: [{ s: start, lockBase: start, placements: [] }] });
    const g = loadSave();
    expect(g?.s).toEqual(s);
    expect(g?.lockBase).toEqual(start);
    expect(g?.placements).toEqual([{ dieId: 0, cell: [1, 2] }]);
    expect(g?.history).toHaveLength(1);
  });

  it("a finished game is not saved, and clears the previous save", () => {
    const s = newGame(fixed(3));
    writeSave({ s, lockBase: s, placements: [], history: [] });
    writeSave({ s: { ...s, phase: "lost" }, lockBase: s, placements: [], history: [] });
    expect(loadSave()).toBeNull();
  });

  it("ignores saves from another version or with a broken shape", () => {
    const s = newGame(fixed(3));
    localStorage.setItem("ufs-save", JSON.stringify({ v: SAVE_VERSION + 1, game: { s, lockBase: s, placements: [], history: [] } }));
    expect(loadSave()).toBeNull();
    localStorage.setItem("ufs-save", JSON.stringify({ v: SAVE_VERSION, game: { s: { round: 1 } } }));
    expect(loadSave()).toBeNull();
    localStorage.setItem("ufs-save", "not json");
    expect(loadSave()).toBeNull();
  });

  it("clearSave removes it", () => {
    const s = newGame(fixed(3));
    writeSave({ s, lockBase: s, placements: [], history: [] });
    clearSave();
    expect(loadSave()).toBeNull();
  });
});
