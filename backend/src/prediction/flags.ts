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

function envDisabled(name: string): boolean {
  const v = process.env[name];
  if (!v) return false;
  const value = v.trim().toLowerCase();
  return value === "false" || value === "0" || value === "off" || value === "no";
}

/**
 * Full-scale rating switch (#2). When enabled, the Elo rating differential
 * enters the probability logistic at FULL scale with the remaining factors added
 * as weighted Elo-point adjustments — instead of shrinking the rating delta by
 * its ~0.40 weight inside a weighted average. Fixes the systemic under-confidence
 * that buried ~78% of picks in the 50-60% band.
 *
 * GRADUATED TO ON BY DEFAULT (2026-06-02) with the conflict-aware sumRatingDelta
 * (eloScale honors thin-data weight cuts; the Elo base blends back toward its
 * legacy value when the trusted factors strongly DISAGREE with it, so a stale
 * Elo edge + home court can't drown a hot/healthy underdog).
 * Validated on the powered 240-day leak-aware ESPN replay (n=100/league, rolled
 * Elo), OFF vs ON: overall acc 58.0→58.7 (NBA flat 66, NHL 53→55, MLB flat 55 —
 * no regression); Brier improves in EVERY league (NBA 0.439→0.434, MLB
 * 0.480→0.476, NHL 0.484→0.480, overall 0.468→0.464); and confidence finally
 * aligns with accuracy (NBA conf 59.9→67.7 for a 66% model, NHL 54.5→58.0,
 * MLB 54.1→57.3). The NBA playoff thin-data guardrail passes under full-scale.
 * Set ENGINE_FULL_SCALE_RATING=false to force the legacy weighted-average branch.
 */
export function isFullScaleRatingEnabled(): boolean {
  return !envDisabled("ENGINE_FULL_SCALE_RATING");
}

/**
 * Tennis rank-reclaim (#11). Tennis has no real player-Elo pipeline, so the 40%
 * rating_diff weight is dead and dilutes the only real signal (ATP/WTA ranking).
 * When enabled, the tennis rating_diff factor is marked unavailable so
 * redistributeWeights reallocates its weight onto the live ranking/form factors.
 * Separate flag from #2 so it can be validated independently.
 *
 * GRADUATED TO ON BY DEFAULT (2026-06-05). The dead Elo weight was diluting
 * the ATP/WTA ranking signal — the only real predictive input for tennis.
 * With reclaim ON, the ranking/form factors absorb the full weight budget,
 * producing sharper separation between ranked and unranked players.
 * Set ENGINE_TENNIS_RANK_RECLAIM=false to force the legacy behavior.
 */
export function isTennisRankReclaimEnabled(): boolean {
  return !envDisabled("ENGINE_TENNIS_RANK_RECLAIM");
}
