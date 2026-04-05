/**
 * Display pass-through — returns raw model values with no modification.
 * The prediction engine outputs honest probabilities; we show them as-is.
 */
export function displayConfidence(rawConfidence: number): number {
  return rawConfidence;
}

export function displayEdgeRating(rawEdge: number): number {
  return rawEdge;
}

export function displayWinProbability(
  homeProb: number,
  awayProb: number
): { home: number; away: number } {
  return { home: homeProb, away: awayProb };
}

/**
 * Display-friendly sport name. Converts internal enum to user-facing label.
 * NCAAF → CFB, NCAAB → CBB, everything else passes through.
 */
export function displaySport(sport: string): string {
  if (sport === 'NCAAF') return 'CFB';
  if (sport === 'NCAAB') return 'CBB';
  return sport;
}

/**
 * Format live game time display per sport.
 * - MLB: inning only, no clock (baseball has no running clock)
 * - EPL/MLS: clock only as match minute (e.g. "65'"), no period label
 * - NFL/NCAAF: quarter + clock (e.g. "Q2 · 5:32")
 * - NBA/NCAAB: quarter + clock (e.g. "Q3 · 8:15")
 * - NHL: period + clock (e.g. "2nd · 12:45")
 */
export function formatGameTime(sport: string, quarter?: string, clock?: string): string | null {
  if (!quarter && !clock) return null;

  switch (sport) {
    case 'MLB':
      // Baseball: just the inning, never show clock
      return quarter || null;
    case 'EPL':
    case 'MLS':
      // Soccer: show clock as match minute, no period needed
      if (clock) return clock;
      return quarter || null;
    default:
      // NFL, NBA, NHL, NCAAF, NCAAB: period/quarter + clock
      if (quarter && clock) return `${quarter} · ${clock}`;
      return quarter || clock || null;
  }
}

/**
 * Returns a human-readable confidence tier label for any confidence percentage.
 */
export function getConfidenceTierLabel(confidence: number): string {
  if (confidence >= 72) return 'Considered a Lock';
  if (confidence >= 60) return 'Considered a Strong Pick';
  if (confidence >= 53) return 'Considered a Solid Pick';
  return 'Considered a Toss-Up';
}
