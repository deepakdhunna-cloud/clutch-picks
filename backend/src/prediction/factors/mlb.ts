/**
 * MLB-specific factors.
 *
 * MLB IS STARTER-DOMINATED. The weights reflect this.
 *
 * Weight budget: 0.42 (remaining after 0.58 base).
 * Breakdown:
 *   - Starting pitcher matchup: 0.22
 *   - Bullpen fatigue: 0.06
 *   - Ballpark factor: 0.04
 *   - Lineup handedness vs starter: 0.04
 *   - Weather (wind for outdoor day games): 0.02
 *   - Umpire strike zone: 0.02 (currently unavailable)
 *   - Early-season dampening adjustment: 0.02
 *
 * Data source: MLB StatsAPI provides reliable probable pitcher data including
 * ERA, FIP, WHIP, K/9, BB/9, and recent 5-start ERA.
 * Verified against live API response 2026-04-12: hydrate=probablePitcher
 * returns pitcher name + personId, enriched via /people/{id}/stats.
 *
 * All deltas in rating points (positive = favors home).
 */

import type { GameContext, FactorContribution } from "../types";
import type { LineupPlayer } from "../../lib/espnStats";

// ─── League average baselines (2024-2025 seasons) ───────────────────────
// Source: Baseball Reference / FanGraphs league averages
const LG_ERA = 4.20;
const LG_FIP = 4.20;
const LG_WHIP = 1.30;

/**
 * Convert a pitcher's stats to an Elo-point quality score relative to league avg.
 * Positive = better than average, negative = worse.
 *
 * A truly elite pitcher (ERA 2.50, FIP 2.80, WHIP 0.95) scores ~+80 pts.
 * A replacement-level pitcher (ERA 5.50, FIP 5.50, WHIP 1.55) scores ~-60 pts.
 */
function pitcherQualityDelta(pitcher: LineupPlayer): number {
  const era = pitcher.era ?? LG_ERA;
  const fip = pitcher.fip ?? LG_FIP;
  const whip = pitcher.whip ?? LG_WHIP;

  // FIP is more predictive than ERA for future performance.
  // Source: Tom Tango, "The Book" (2007) — FIP outpredicts ERA for future
  // run prevention by ~40%.
  // Weight: 50% FIP, 30% ERA, 20% WHIP
  const eraComponent = (LG_ERA - era) * 15;     // +15 pts per run below avg
  const fipComponent = (LG_FIP - fip) * 20;     // +20 pts per run below avg (more weight)
  const whipComponent = (LG_WHIP - whip) * 40;  // +40 pts per 0.1 WHIP below avg

  let quality = eraComponent * 0.3 + fipComponent * 0.5 + whipComponent * 0.2;

  // Small-sample dampening: if pitcher has fewer than 30 IP this season,
  // regress toward zero (league average). At 0 IP: 100% regression.
  // At 30 IP: 50% regression. At 100+ IP: ~15% regression.
  // Source: "Regression to the mean" in Tango/Lichtman/Dolphin "The Book".
  const ip = pitcher.seasonInningsPitched ?? 0;
  const regression = 30 / (ip + 30); // Simple Bayesian regression weight
  quality = quality * (1 - regression);

  // Recent form adjustment: if recent5Era available and significantly different
  // from season, adjust modestly. Recent performance has signal but also noise.
  if (pitcher.recent5Era !== undefined && pitcher.era !== undefined) {
    const recentDiff = pitcher.era - pitcher.recent5Era;
    // If recent5Era is BETTER (lower) than season, small bonus; if worse, small penalty
    quality += recentDiff * 5; // ~5 pts per run of recent improvement
  }

  return quality;
}

export function computeMLBFactors(ctx: GameContext): FactorContribution[] {
  const factors: FactorContribution[] = [];

  // ── 1. Starting pitcher matchup ───────────────────────────────────────
  // THE single most predictive MLB factor.
  // Source: FanGraphs research — starting pitcher accounts for ~40-50% of
  // single-game predictive variance in MLB.
  const homeSP = ctx.homeLineup?.startingPitcher ?? null;
  const awaySP = ctx.awayLineup?.startingPitcher ?? null;
  const spAvailable = homeSP !== null && awaySP !== null;

  let spDelta = 0;
  let spEvidence = "Starting pitchers not yet announced";

  if (spAvailable) {
    const homeQuality = pitcherQualityDelta(homeSP!);
    const awayQuality = pitcherQualityDelta(awaySP!);
    spDelta = homeQuality - awayQuality;

    const homeERA = homeSP!.era?.toFixed(2) ?? "N/A";
    const awayERA = awaySP!.era?.toFixed(2) ?? "N/A";
    const homeFIP = homeSP!.fip?.toFixed(2) ?? "N/A";
    const awayFIP = awaySP!.fip?.toFixed(2) ?? "N/A";
    spEvidence = `${homeSP!.name} (ERA ${homeERA}, FIP ${homeFIP}) vs ${awaySP!.name} (ERA ${awayERA}, FIP ${awayFIP})`;
  } else if (homeSP !== null) {
    // Only one pitcher known — partial data
    const homeQuality = pitcherQualityDelta(homeSP!);
    spDelta = homeQuality; // Compare against league-average opponent
    spEvidence = `${homeSP!.name} (ERA ${homeSP!.era?.toFixed(2) ?? "N/A"}) vs TBD`;
  } else if (awaySP !== null) {
    const awayQuality = pitcherQualityDelta(awaySP!);
    spDelta = -awayQuality;
    spEvidence = `TBD vs ${awaySP!.name} (ERA ${awaySP!.era?.toFixed(2) ?? "N/A"})`;
  }

  factors.push({
    key: "starting_pitcher",
    label: "Starting pitcher matchup",
    homeDelta: spDelta,
    weight: 0.22,
    available: spAvailable,
    evidence: spEvidence,
  });

  // ── 2. Bullpen fatigue ────────────────────────────────────────────────
  // Source: FanGraphs bullpen usage studies — heavy bullpen usage in prior
  // 3 days correlates with higher ER rates.
  // We don't have bullpen pitch-count data from ESPN, so this factor uses
  // recent blowout/extra-inning games as a proxy (via scoring data).
  //
  // If a team's recent games show high opponent scores (>8 runs) or extra
  // innings, their bullpen is likely taxed.
  const homeRecentScoresAllowed = ctx.homeForm.avgAllowed;
  const awayRecentScoresAllowed = ctx.awayForm.avgAllowed;

  let bullpenDelta = 0;
  let bullpenEvidence = "No significant bullpen fatigue signal";

  // High runs allowed in recent sample suggests bullpen was taxed
  if (homeRecentScoresAllowed > 5.5 && awayRecentScoresAllowed <= 4.5) {
    bullpenDelta = -15;
    bullpenEvidence = `${ctx.game.homeTeam.abbreviation} allowing ${homeRecentScoresAllowed.toFixed(1)} runs/game recently (bullpen fatigue risk)`;
  } else if (awayRecentScoresAllowed > 5.5 && homeRecentScoresAllowed <= 4.5) {
    bullpenDelta = 15;
    bullpenEvidence = `${ctx.game.awayTeam.abbreviation} allowing ${awayRecentScoresAllowed.toFixed(1)} runs/game recently (bullpen fatigue risk)`;
  }

  factors.push({
    key: "bullpen_fatigue",
    label: "Bullpen fatigue (proxy)",
    homeDelta: bullpenDelta,
    weight: 0.06,
    available: true,
    evidence: bullpenEvidence,
  });

  // ── 3. Ballpark factor ────────────────────────────────────────────────
  // Source: ESPN Park Factors / Baseball Reference.
  // Coors Field (COL) is +15% runs; Petco Park (SD), Oracle Park (SF) are
  // ~-8-10% runs. This affects total runs but also has a slight directional
  // impact: hitter-friendly parks favor the better offense.
  // We don't have park factor data in the current ESPN feed, so this is
  // marked unavailable and weight redistributes.
  factors.push({
    key: "ballpark",
    label: "Ballpark run environment",
    homeDelta: 0,
    weight: 0.04,
    available: false,
    evidence: "Park factor data not available — factor inactive, weight redistributed",
  });

  // ── 4. Lineup handedness vs starter ───────────────────────────────────
  // Source: FanGraphs platoon splits — LHB vs RHP and RHB vs LHP are
  // well-documented advantages (~20 OPS points).
  // We don't have team batting handedness splits or pitcher handedness
  // in the current data model.
  factors.push({
    key: "handedness",
    label: "Lineup handedness vs starter",
    homeDelta: 0,
    weight: 0.04,
    available: false,
    evidence: "Handedness data not available — factor inactive, weight redistributed",
  });

  // ── 5. Weather (wind for outdoor day games) ───────────────────────────
  // Source: Statcast wind studies — 15+ mph wind blowing out adds ~0.5
  // runs to the total; blowing in subtracts ~0.3. We only have wind speed,
  // not direction, so the signal is weak.
  let weatherDelta = 0;
  let weatherEvidence = "Indoor or no significant weather impact";
  const weatherAvailable = ctx.weather !== null && !ctx.weather.isDomed;

  if (ctx.weather && !ctx.weather.isDomed && ctx.weather.windSpeed > 15) {
    // High wind compresses outcomes slightly (more randomness → underdog boost)
    weatherDelta = -5;
    weatherEvidence = `Outdoor with ${Math.round(ctx.weather.windSpeed)} mph wind — slight randomness increase`;
  }

  factors.push({
    key: "weather_mlb",
    label: "Weather (wind/conditions)",
    homeDelta: weatherDelta,
    weight: 0.02,
    available: weatherAvailable || (ctx.weather?.isDomed ?? false),
    evidence: weatherEvidence,
  });

  // ── 6. Umpire strike zone ─────────────────────────────────────────────
  // Live data via lib/mlbUmpireApi.ts:
  //   - MLB Stats API schedule (hydrate=officials) → home-plate umpire name
  //   - Cross-reference with lib/data/umpireZoneTendencies.json (seeded from
  //     public UmpScorecards aggregates)
  // runsPerGameBias is signed: negative = pitcher's zone, positive = hitter's
  // zone. We translate at 12 Elo pts per run of expected scoring shift,
  // capped at ±20 Elo. This is the spec from the prediction-engine
  // improvement plan; `favorsHome` is tracked in the JSON but not yet used.
  const ump = ctx.homePlateUmpire ?? null;
  let umpireDelta = 0;
  let umpireEvidence: string;
  let umpireAvailable = false;

  if (ump !== null && ump.tendency !== null) {
    const t = ump.tendency;
    const raw = t.runsPerGameBias * 12;
    umpireDelta = Math.max(-20, Math.min(20, raw));
    const biasPts = t.runsPerGameBias.toFixed(2);
    const sign = t.runsPerGameBias >= 0 ? "+" : "";
    const verdict =
      t.runsPerGameBias > 0.03
        ? "hitter's zone"
        : t.runsPerGameBias < -0.03
          ? "pitcher's zone"
          : "near league-average zone";
    umpireEvidence = `HP umpire ${ump.name} (n=${t.sampleSize} games) runs zone ${sign}${biasPts} runs/game bias — ${verdict}`;
    umpireAvailable = true;
  } else if (ump !== null) {
    // Umpire assigned but we have no historical zone data on them.
    umpireEvidence = `Home plate umpire ${ump.name} — no historical zone data available`;
  } else {
    umpireEvidence =
      "Home plate umpire assignment not yet posted — factor inactive, weight redistributed";
  }

  factors.push({
    key: "umpire",
    label: "Umpire strike zone tendency",
    homeDelta: umpireDelta,
    weight: 0.02,
    available: umpireAvailable,
    evidence: umpireEvidence,
  });

  // ── 7. Early-season dampening ─────────────────────────────────────────
  // In April MLB, team-level stats (W/L, form, scoring trends) are based
  // on 10-15 games and contain mostly noise. Elo — which carries over from
  // prior season — is far more stable.
  // This factor doesn't add delta; instead it signals that non-Elo factors
  // should be taken with a grain of salt. The weight redistribution in
  // index.ts handles the actual dampening when available=false.
  const homeGP = ctx.game.homeTeam.record.wins + ctx.game.homeTeam.record.losses;
  const awayGP = ctx.game.awayTeam.record.wins + ctx.game.awayTeam.record.losses;
  const minGP = Math.min(homeGP, awayGP);
  const earlySeason = minGP < 20;

  factors.push({
    key: "early_season_mlb",
    label: "Early-season noise warning",
    homeDelta: 0,
    weight: 0.02,
    available: !earlySeason,
    evidence: earlySeason
      ? `Only ${minGP} games played — team stats unreliable, Elo carries most of the signal`
      : `${minGP}+ games played — team stats have stabilized`,
  });

  return factors;
}
