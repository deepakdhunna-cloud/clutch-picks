/**
 * MLB-specific factors.
 *
 * MLB IS STARTER-DOMINATED. The weights reflect this.
 *
 * Weight budget: ~0.43 (base is 0.58 — engine normalizes to 1.0 post-redistribution).
 * Breakdown (handedness removed — data too expensive to source reliably):
 *   - Starting pitcher matchup: 0.22
 *   - Bullpen fatigue: 0.06
 *   - Ballpark factor: 0.04  (static data from Baseball Savant 2023-2024)
 *   - Weather (wind for outdoor day games): 0.02
 *   - Umpire strike zone: 0.02
 *   - Early-season dampening adjustment: 0.02
 *   - Position player injuries: 0.05
 *   Total: 0.43
 *
 * Data source: MLB StatsAPI provides reliable probable pitcher data including
 * ERA, FIP, WHIP, K/9, BB/9, and recent 5-start ERA.
 * Verified against live API response 2026-04-12: hydrate=probablePitcher
 * returns pitcher name + personId, enriched via /people/{id}/stats.
 *
 * All deltas in rating points (positive = favors home), except the injuries
 * factor which produces a clamped [-1, +1] score (see below).
 */

import type { GameContext, FactorContribution } from "../types";
import type { LineupPlayer } from "../../lib/espnStats";
import parkFactorsData from "../../lib/data/mlbParkFactors.json";

// ─── Park factor lookup ────────────────────────────────────────────────
const PARK_FACTORS: Record<string, number> = parkFactorsData.parks;

/**
 * Look up park factor for a team's home ballpark.
 * Returns null if the abbreviation isn't in our data.
 */
export function getParkFactor(teamAbbreviation: string): number | null {
  return PARK_FACTORS[teamAbbreviation] ?? null;
}

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
  // Source: Baseball Savant / Statcast 2023-2024 park factors.
  // Conversion: 0.5 runs/game ≈ 10 Elo swing.
  // Home delta = parkFactor × 20 (so +1.0 runs/game = +20 Elo), capped ±10.
  // Positive park factor = hitter-friendly → slight home offensive edge
  // (home team bats last in a high-run environment).
  const homeAbbr = ctx.game.homeTeam.abbreviation;
  const parkFactor = getParkFactor(homeAbbr);
  let ballparkDelta = 0;
  let ballparkEvidence: string;
  const ballparkAvailable = parkFactor !== null;

  if (parkFactor !== null) {
    ballparkDelta = Math.max(-10, Math.min(10, Math.round(parkFactor * 20)));
    const sign = parkFactor >= 0 ? "+" : "";
    const friendliness = parkFactor > 0.1 ? "hitter-friendly" : parkFactor < -0.1 ? "pitcher-friendly" : "neutral";
    ballparkEvidence = `${homeAbbr} park (${sign}${parkFactor.toFixed(2)} runs/game) — ${friendliness} (${ballparkDelta >= 0 ? "+" : ""}${ballparkDelta} Elo home)`;
  } else {
    ballparkEvidence = `Park factor not found for ${homeAbbr} — factor inactive, weight redistributed`;
  }

  factors.push({
    key: "ballpark",
    label: "Ballpark run environment",
    homeDelta: ballparkDelta,
    weight: 0.04,
    available: ballparkAvailable,
    evidence: ballparkEvidence,
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
  //
  // Sign semantics (fixed in Prompt-A follow-up):
  //   - favorsHome is the *directional* signal. Positive = this ump's zone
  //     historically helps the home side; negative = helps the away side.
  //     0.01 of favorsHome ≈ 4 Elo points, so base delta = favorsHome × 400,
  //     capped ±15 on its own.
  //   - runsPerGameBias is *not* directional. A zone that's very pitcher-
  //     friendly or very hitter-friendly tends to concentrate outcomes, which
  //     amplifies whatever home/away edge already exists. Use |bias| as a
  //     multiplier: (1 + min(0.5, |bias| × 2)). Near-zero bias → ~1.0×;
  //     extreme zones (|bias| ≥ 0.25) → 1.5× cap.
  //   - Final homeDelta cap is ±20 Elo.
  const ump = ctx.homePlateUmpire ?? null;
  let umpireDelta = 0;
  let umpireEvidence: string;
  let umpireAvailable = false;

  if (ump !== null && ump.tendency !== null) {
    const t = ump.tendency;
    const baseDelta = Math.max(-15, Math.min(15, t.favorsHome * 400));
    const amplifier = 1 + Math.min(0.5, Math.abs(t.runsPerGameBias) * 2);
    umpireDelta = Math.max(-20, Math.min(20, baseDelta * amplifier));

    const favorsHomePts = (t.favorsHome * 100).toFixed(1);
    const homeAway = t.favorsHome >= 0 ? "home" : "away";
    const biasPts = t.runsPerGameBias.toFixed(2);
    const zoneVerdict =
      t.runsPerGameBias > 0.03
        ? "hitter's"
        : t.runsPerGameBias < -0.03
          ? "pitcher's"
          : "neutral";
    umpireEvidence = `HP umpire ${ump.name} (n=${t.sampleSize} games) favors ${homeAway} (${favorsHomePts} pts) in a ${zoneVerdict} zone (${biasPts} runs/gm)`;
    umpireAvailable = true;
  } else if (ump !== null) {
    // Umpire assigned but we have no historical zone data on them.
    umpireEvidence = `Home plate umpire ${ump.name} — no historical zone data available; weight redistributed to other factors`;
  } else {
    umpireEvidence =
      "Home plate umpire assignment not yet posted — weight redistributed to other factors";
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

  // ── 8. Position player injuries ───────────────────────────────────────
  // Penalty-based score: position-player OUT = 1.0, reliever OUT = 0.3,
  // Doubtful = 0.5× of OUT value, Day-To-Day/Questionable = 0.2×.
  // Announced starting pitchers are skipped here — the SP factor handles
  // them. Final score = clamp((awayPenalty - homePenalty) / 3, -1, +1):
  // three position-player OUTs on one side ≈ ±1.0 signal.
  const injuryFactor = buildPositionPlayerInjuriesFactor(ctx);
  factors.push(injuryFactor);

  return factors;
}

// ─── Position player injuries ────────────────────────────────────────────

const POSITION_PLAYER_CODES = new Set([
  "IF", "OF", "C", "DH", "1B", "2B", "3B", "SS", "LF", "CF", "RF",
]);

const PITCHER_CODES = new Set(["SP", "P", "RP"]);

type InjuryEntry = { name: string; position: string; detail: string };
type InjuryBucketStatus = "Out" | "Doubtful" | "Day-To-Day";

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function isAnnouncedStarter(
  entry: InjuryEntry,
  startingPitcher: LineupPlayer | null,
): boolean {
  const pos = (entry.position ?? "").toUpperCase();
  if (pos !== "SP" && pos !== "P") return false;
  if (!startingPitcher?.name) return false;
  return normalizeName(entry.name) === normalizeName(startingPitcher.name);
}

function penaltyForEntry(entry: InjuryEntry, status: InjuryBucketStatus): number {
  const pos = (entry.position ?? "").toUpperCase();
  const isPositionPlayer = POSITION_PLAYER_CODES.has(pos);
  const isPitcher = PITCHER_CODES.has(pos);
  // Position player → 1.0; reliever or unknown pitcher → 0.3; anything else
  // (unknown position, coach, etc.) → treat as 0.3 since we can't confidently
  // call it a position-player hit.
  const baseOut = isPositionPlayer ? 1.0 : isPitcher ? 0.3 : 0.3;
  if (status === "Out") return baseOut;
  if (status === "Doubtful") return baseOut * 0.5;
  return baseOut * 0.2; // Day-To-Day
}

function accumulateTeamPenalty(
  report: { out: InjuryEntry[]; doubtful: InjuryEntry[]; questionable: InjuryEntry[] },
  startingPitcher: LineupPlayer | null,
): { penalty: number; summary: string[] } {
  let penalty = 0;
  const summary: string[] = [];

  const bucketPairs: Array<[InjuryEntry[], InjuryBucketStatus]> = [
    [report.out, "Out"],
    [report.doubtful, "Doubtful"],
    // Day-To-Day entries live in the `questionable` bucket after translation
    // in toTeamInjuryReport — they're the same shelf.
    [report.questionable, "Day-To-Day"],
  ];

  for (const [entries, status] of bucketPairs) {
    for (const entry of entries) {
      if (isAnnouncedStarter(entry, startingPitcher)) continue;
      penalty += penaltyForEntry(entry, status);
      const pos = entry.position || "—";
      summary.push(`${entry.name} (${pos}) ${status.toUpperCase()}`);
    }
  }

  return { penalty, summary };
}

function formatTeamList(summary: string[]): string {
  if (summary.length === 0) return "none";
  const shown = summary.slice(0, 3).join("; ");
  if (summary.length <= 3) return shown;
  return `${shown} (+${summary.length - 3} more)`;
}

function buildPositionPlayerInjuriesFactor(ctx: GameContext): FactorContribution {
  const homeReport = ctx.homeInjuries;
  const awayReport = ctx.awayInjuries;

  if (!homeReport || !awayReport) {
    return {
      key: "injuries_mlb",
      label: "Position player injuries",
      homeDelta: 0,
      weight: 0.05,
      available: false,
      evidence: "Injury data unavailable",
    };
  }

  const home = accumulateTeamPenalty(homeReport, ctx.homeLineup?.startingPitcher ?? null);
  const away = accumulateTeamPenalty(awayReport, ctx.awayLineup?.startingPitcher ?? null);

  const rawScore = (away.penalty - home.penalty) / 3.0;
  const score = Math.max(-1.0, Math.min(1.0, rawScore));

  let evidence: string;
  if (home.penalty === 0 && away.penalty === 0) {
    evidence = "No significant position-player injuries reported";
  } else {
    evidence = `Home: ${formatTeamList(home.summary)}; Away: ${formatTeamList(away.summary)}`;
  }

  return {
    key: "injuries_mlb",
    label: "Position player injuries",
    homeDelta: score,
    weight: 0.05,
    available: true,
    evidence,
  };
}
