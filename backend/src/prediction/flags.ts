/**
 * Engine feature flags (read from env, no dependencies — safe to import from
 * any prediction module without creating import cycles).
 */

function envEnabled(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  const value = v.trim().toLowerCase();
  return value === "true" || value === "1" || value === "on" || value === "yes";
}

/**
 * Full-scale rating switch (#2). When enabled, the Elo rating differential
 * enters the probability logistic at FULL scale with the remaining factors added
 * as weighted Elo-point adjustments — instead of shrinking the rating delta by
 * its ~0.40 weight inside a weighted average. Fixes the systemic under-confidence
 * that buried ~78% of picks in the 50-60% band.
 *
 * Validated on the 90-day ESPN replay: NBA acc 70.7→72.0 (conf 59→68, Brier
 * 0.423→0.400), NHL acc 59.3→62.0, overall Brier 0.465→0.457. MLB regresses
 * slightly (~noise) because baseball Elo is a weak signal — its fix is the
 * data-driven per-league recalibration map (#5/#3), NOT a hand-tune.
 *
 * Default OFF until enabled for production after review.
 */
export function isFullScaleRatingEnabled(): boolean {
  return envEnabled("ENGINE_FULL_SCALE_RATING");
}
