// The game in progress, kept on this device so closing the app doesn't lose it.
import type { Cell, GameState } from "./engine";

/** Bump when GameState (or this shape) changes incompatibly: older saves are then ignored, not loaded. */
export const SAVE_VERSION = 1;
const KEY = "ufs-save";

export type Placement = { dieId: number; cell: Cell };
/** Everything needed to resume exactly, including undo: the state, the dice-phase snapshot and placements, and resolve-phase history. */
export interface Snapshot {
  s: GameState;
  lockBase: GameState;
  placements: Placement[];
}
export interface SavedGame extends Snapshot {
  history: Snapshot[];
}

const looksLikeState = (x: unknown): x is GameState => {
  const s = x as GameState | null;
  return !!s && typeof s.difficulty === "string" && typeof s.round === "number" && typeof s.phase === "string" && Array.isArray(s.dice) && Array.isArray(s.ships) && Array.isArray(s.robots);
};
const looksLikeSnapshot = (x: unknown): x is Snapshot => {
  const p = x as Snapshot | null;
  return !!p && looksLikeState(p.s) && looksLikeState(p.lockBase) && Array.isArray(p.placements);
};

/** The saved game, or null if there is none, it's finished, or it's from an incompatible version. */
export function loadSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { v?: number; game?: SavedGame };
    const g = data.game;
    if (data.v !== SAVE_VERSION || !g || !looksLikeSnapshot(g) || !Array.isArray(g.history) || !g.history.every(looksLikeSnapshot)) return null;
    if (g.s.phase === "won" || g.s.phase === "lost") return null;
    return g;
  } catch {
    return null;
  }
}

export function writeSave(game: SavedGame) {
  try {
    if (game.s.phase === "won" || game.s.phase === "lost") clearSave();
    else localStorage.setItem(KEY, JSON.stringify({ v: SAVE_VERSION, game }));
  } catch {
    // Storage full or unavailable: the game still works, it just won't resume.
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
