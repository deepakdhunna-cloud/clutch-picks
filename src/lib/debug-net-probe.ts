// TEMPORARY diagnostic. Captures the raw, unprocessed network result for the
// home games endpoint so the on-device overlay can display the network truth
// (URL hit, HTTP status, raw item count, sample row) BEFORE any client-side
// filtering/merging. Remove together with HomeDebugOverlay once the blank-board
// investigation is closed.

export type GamesNetProbe = {
  url: string;
  status: number;
  rawCount: number;
  finishedAt: number;
  sample?: { id?: string; sport?: string; gameTime?: string };
  error?: string;
};

let lastGamesProbe: GamesNetProbe | null = null;

export function recordGamesProbe(p: GamesNetProbe): void {
  lastGamesProbe = p;
}

export function getGamesProbe(): GamesNetProbe | null {
  return lastGamesProbe;
}
