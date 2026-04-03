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
 * Returns a human-readable confidence tier label for any confidence percentage.
 */
export function getConfidenceTierLabel(confidence: number): string {
  if (confidence >= 70) return 'Considered a Lock';
  if (confidence >= 65) return 'Considered a High Confidence Pick';
  if (confidence >= 60) return 'Considered a Strong Pick';
  if (confidence >= 55) return 'Considered a Solid Pick';
  return 'Considered a Lean';
}
