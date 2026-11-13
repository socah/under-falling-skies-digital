// Per-setup game history, kept on this device.
export interface SetupStats { played: number; won: number; bestRounds: number | null; last: number }
const KEY = "ufs-stats";

export function loadStats(): Record<string, SetupStats> {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
export function recordResult(setup: string, won: boolean, rounds: number) {
  const all = loadStats();
  const cur = all[setup] ?? { played: 0, won: 0, bestRounds: null, last: 0 };
  cur.played++;
  if (won) { cur.won++; cur.bestRounds = cur.bestRounds === null ? rounds : Math.min(cur.bestRounds, rounds); }
  cur.last = Date.now();
  all[setup] = cur;
  localStorage.setItem(KEY, JSON.stringify(all));
}
