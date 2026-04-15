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
    case 'UCL':
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

/**
 * Canonical confidence tier — { short label, color } pair used across the app
 * (game cards, detail page, search results, the confidence-explained screen).
 *
 * This is the SINGLE SOURCE OF TRUTH for tier labels and colors. Every screen
 * that displays a tier MUST go through this helper. Any place that hardcodes
 * its own tier ladder will drift out of sync (we have a history of this — see
 * the card↔detail mismatches earlier in the project) so do not duplicate it.
 *
 * The palette is intentionally neutral: graduated lightness on cool grays so
 * higher tiers feel "premium" without competing with the maroon accent color.
 */
export interface ConfidenceTier {
  label: 'Toss-Up' | 'Solid Pick' | 'Strong Pick' | 'Lock';
  color: string;
}

export function getConfidenceTier(confidence: number, isTossUp?: boolean): ConfidenceTier {
  if (isTossUp || confidence < 51) return { label: 'Toss-Up',     color: '#6B7280' };
  if (confidence < 60)             return { label: 'Solid Pick',  color: '#94A3B8' };
  if (confidence < 72)             return { label: 'Strong Pick', color: '#CBD5E1' };
  return                                  { label: 'Lock',        color: '#F1F5F9' };
}
