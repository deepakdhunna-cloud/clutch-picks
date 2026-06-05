import type { FactorContribution, GameContext, ProjectionSignal } from "../types";

export type ScoringBaseline = {
  total: number;
  totalMin: number;
  totalMax: number;
  marginSd: number;
  totalSd: number;
  minScore: number;
  granularity: number;
};

type FeatureStatus = {
  key: string;
  label: string;
  available: boolean;
  critical: boolean;
  evidence: string;
};

type FeatureCheck = (ctx: GameContext, factors: FactorContribution[]) => FeatureStatus;

export type SportSimulationProfile = {
  sport: string;
  engineLabel: string;
  scoringUnit: string;
  baseline: ScoringBaseline;
  marginPer100Elo: number;
  ratingPriorBlendWithScoreBaseline: number;
  ratingPriorBlendWithoutScoreBaseline: number;
  meaningfulMarginThreshold: number;
  minMean: number;
  netRatingShiftDivisor: number;
  netRatingShiftCap: number;
  trendMarginMultiplier: number;
  trendMarginCap: number;
  venueSplitMultiplier: number;
  venueSplitCap: number;
  maxVarianceMultiplier: number;
  featureChecks: FeatureCheck[];
};

export type SimulationReadiness = {
  profile: SportSimulationProfile;
  score: number;
  missingCritical: FeatureStatus[];
  missingSupporting: FeatureStatus[];
  varianceMultiplier: number;
  totalVarianceMultiplier: number;
  signals: ProjectionSignal[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function factorStatus(
  key: string,
  label: string,
  critical: boolean,
): FeatureCheck {
  return (_ctx, factors) => {
    const factor = factors.find((f) => f.key === key);
    return {
      key,
      label,
      critical,
      available: Boolean(factor?.available),
      evidence: factor?.evidence ?? `${label} factor was not produced`,
    };
  };
}

function factorKeyIncludesStatus(
  keyIncludes: string,
  label: string,
  critical: boolean,
): FeatureCheck {
  return (_ctx, factors) => {
    const factor = factors.find((f) => f.key.includes(keyIncludes));
    return {
      key: keyIncludes,
      label,
      critical,
      available: Boolean(factor?.available),
      evidence: factor?.evidence ?? `${label} factor was not produced`,
    };
  };
}

function scoreFormStatus(ctx: GameContext): FeatureStatus {
  const available =
    ctx.homeForm.avgScore > 0 &&
    ctx.awayForm.avgScore > 0 &&
    ctx.homeForm.avgAllowed > 0 &&
    ctx.awayForm.avgAllowed > 0;

  return {
    key: "score_form",
    label: "Recent scoring baseline",
    critical: true,
    available,
    evidence: available
      ? `Recent scoring/allowed baselines available for ${ctx.game.homeTeam.abbreviation} and ${ctx.game.awayTeam.abbreviation}`
      : "Recent scoring/allowed baselines are incomplete",
  };
}

function marketStatus(ctx: GameContext): FeatureStatus {
  const available =
    Boolean(ctx.marketConsensus) ||
    typeof ctx.marketSpread === "number" ||
    typeof ctx.marketOverUnder === "number";

  return {
    key: "market_anchor",
    label: "Market spread/total anchor",
    critical: false,
    available,
    evidence: available
      ? "Market spread, total, or consensus is available for projection calibration"
      : "No market spread/total anchor available for the simulator",
  };
}

function weatherIfOutdoorStatus(ctx: GameContext): FeatureStatus {
  const needsWeather = ctx.sport === "NFL" || ctx.sport === "NCAAF" || ctx.sport === "MLB";
  return {
    key: "weather_context",
    label: "Weather context",
    critical: false,
    available: !needsWeather || ctx.weather !== null,
    evidence:
      !needsWeather
        ? "Weather is not a primary simulator input for this league"
        : ctx.weather
          ? "Weather context available"
          : "Weather context missing for an outdoor-sensitive league",
  };
}

const commonScoreChecks: FeatureCheck[] = [
  (ctx) => scoreFormStatus(ctx),
  (ctx) => marketStatus(ctx),
];

const footballScoreChecks: FeatureCheck[] = [
  (ctx) => scoreFormStatus(ctx),
  (ctx) => marketStatus(ctx),
  (ctx) => weatherIfOutdoorStatus(ctx),
];

const PROFILES: Record<string, SportSimulationProfile> = {
  NBA: {
    sport: "NBA",
    engineLabel: "NBA possession proxy",
    scoringUnit: "points",
    baseline: { total: 224, totalMin: 185, totalMax: 255, marginSd: 12.5, totalSd: 15, minScore: 75, granularity: 1 },
    marginPer100Elo: 4.5,
    ratingPriorBlendWithScoreBaseline: 0.46,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.6,
    minMean: 80,
    netRatingShiftDivisor: 30,
    netRatingShiftCap: 3,
    trendMarginMultiplier: 2.2,
    trendMarginCap: 2.5,
    venueSplitMultiplier: 3.5,
    venueSplitCap: 2,
    maxVarianceMultiplier: 1.18,
    featureChecks: [
      ...commonScoreChecks,
      factorStatus("net_rating", "Pace-adjusted net rating", true),
      factorStatus("injuries_nba", "Star player availability", true),
      factorStatus("back_to_back", "Back-to-back fatigue", false),
      factorStatus("rotation_fatigue", "Rotation fatigue", false),
    ],
  },
  NCAAB: {
    sport: "NCAAB",
    engineLabel: "NCAAB tempo/efficiency proxy",
    scoringUnit: "points",
    baseline: { total: 144, totalMin: 108, totalMax: 178, marginSd: 10.5, totalSd: 11, minScore: 45, granularity: 1 },
    marginPer100Elo: 3.8,
    ratingPriorBlendWithScoreBaseline: 0.48,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.6,
    minMean: 48,
    netRatingShiftDivisor: 34,
    netRatingShiftCap: 2.5,
    trendMarginMultiplier: 2.2,
    trendMarginCap: 2.5,
    venueSplitMultiplier: 3,
    venueSplitCap: 1.8,
    maxVarianceMultiplier: 1.22,
    featureChecks: [
      ...commonScoreChecks,
      factorStatus("net_rating_ncaamb", "Efficiency/net rating", true),
      factorStatus("injuries_ncaamb", "Rotation availability", true),
      factorStatus("scoring_trend_ncaamb", "Recent scoring trend", false),
      factorStatus("three_point_regression_ncaamb", "Three-point variance", false),
    ],
  },
  NFL: {
    sport: "NFL",
    engineLabel: "NFL drive-efficiency proxy",
    scoringUnit: "points",
    baseline: { total: 45, totalMin: 30, totalMax: 63, marginSd: 13.5, totalSd: 10, minScore: 0, granularity: 1 },
    marginPer100Elo: 4.9,
    ratingPriorBlendWithScoreBaseline: 0.52,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.45,
    minMean: 0.15,
    netRatingShiftDivisor: 42,
    netRatingShiftCap: 2.2,
    trendMarginMultiplier: 1.2,
    trendMarginCap: 2.2,
    venueSplitMultiplier: 3,
    venueSplitCap: 2,
    maxVarianceMultiplier: 1.22,
    featureChecks: [
      ...footballScoreChecks,
      factorStatus("starting_qb", "Starting QB status", true),
      factorStatus("injuries_nfl", "Non-QB injuries", true),
      factorStatus("rest_edge_nfl", "Bye/short-week rest", false),
    ],
  },
  NCAAF: {
    sport: "NCAAF",
    engineLabel: "NCAAF drive/tempo proxy",
    scoringUnit: "points",
    baseline: { total: 52, totalMin: 34, totalMax: 78, marginSd: 16, totalSd: 13, minScore: 0, granularity: 1 },
    marginPer100Elo: 5.8,
    ratingPriorBlendWithScoreBaseline: 0.5,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.45,
    minMean: 0.15,
    netRatingShiftDivisor: 42,
    netRatingShiftCap: 2.5,
    trendMarginMultiplier: 1.3,
    trendMarginCap: 2.6,
    venueSplitMultiplier: 3.2,
    venueSplitCap: 2.2,
    maxVarianceMultiplier: 1.25,
    featureChecks: [
      ...footballScoreChecks,
      factorStatus("starting_qb_ncaaf", "Starting QB status", true),
      factorStatus("injuries_ncaaf", "Injuries", true),
      factorStatus("scoring_trend_ncaaf", "Scoring trend", false),
    ],
  },
  MLB: {
    sport: "MLB",
    engineLabel: "MLB starter/bullpen run model",
    scoringUnit: "runs",
    baseline: { total: 8.6, totalMin: 5.2, totalMax: 13.4, marginSd: 3.2, totalSd: 2.2, minScore: 0, granularity: 1 },
    marginPer100Elo: 1.15,
    ratingPriorBlendWithScoreBaseline: 0.38,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.12,
    minMean: 0.15,
    netRatingShiftDivisor: 52,
    netRatingShiftCap: 1.2,
    trendMarginMultiplier: 1.2,
    trendMarginCap: 1.4,
    venueSplitMultiplier: 1.2,
    venueSplitCap: 1.2,
    maxVarianceMultiplier: 1.3,
    featureChecks: [
      ...commonScoreChecks,
      (ctx) => weatherIfOutdoorStatus(ctx),
      factorStatus("starting_pitcher", "Starting pitcher matchup", true),
      factorStatus("bullpen_fatigue", "Bullpen fatigue", true),
      factorStatus("ballpark", "Ballpark run environment", false),
      factorStatus("umpire", "Plate umpire tendency", false),
      factorStatus("injuries_mlb", "Position-player availability", false),
    ],
  },
  NHL: {
    sport: "NHL",
    engineLabel: "NHL goalie/special-teams model",
    scoringUnit: "goals",
    baseline: { total: 6.1, totalMin: 4.0, totalMax: 8.6, marginSd: 2.2, totalSd: 1.6, minScore: 0, granularity: 1 },
    marginPer100Elo: 0.8,
    ratingPriorBlendWithScoreBaseline: 0.4,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.12,
    minMean: 0.15,
    netRatingShiftDivisor: 48,
    netRatingShiftCap: 1.3,
    trendMarginMultiplier: 1.2,
    trendMarginCap: 1.5,
    venueSplitMultiplier: 1.2,
    venueSplitCap: 1.2,
    maxVarianceMultiplier: 1.24,
    featureChecks: [
      ...commonScoreChecks,
      factorStatus("starting_goalie", "Starting goalie/team save data", true),
      factorStatus("special_teams", "Special teams", true),
      factorStatus("injuries_nhl", "Skater injuries", false),
      factorStatus("b2b_backup", "Back-to-back goalie/fatigue", false),
    ],
  },
  MLS: {
    sport: "MLS",
    engineLabel: "MLS xG/draw-risk proxy",
    scoringUnit: "goals",
    baseline: { total: 2.7, totalMin: 1.4, totalMax: 4.4, marginSd: 1.55, totalSd: 1.1, minScore: 0, granularity: 1 },
    marginPer100Elo: 0.56,
    ratingPriorBlendWithScoreBaseline: 0.42,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.12,
    minMean: 0.15,
    netRatingShiftDivisor: 60,
    netRatingShiftCap: 0.9,
    trendMarginMultiplier: 1.1,
    trendMarginCap: 1,
    venueSplitMultiplier: 1.2,
    venueSplitCap: 1,
    maxVarianceMultiplier: 1.28,
    featureChecks: [
      ...commonScoreChecks,
      factorStatus("stakes", "Table stakes context", false),
      factorKeyIncludesStatus("rest", "Fixture/rest congestion", false),
    ],
  },
  EPL: {
    sport: "EPL",
    engineLabel: "EPL xG/draw-risk proxy",
    scoringUnit: "goals",
    baseline: { total: 2.8, totalMin: 1.4, totalMax: 4.5, marginSd: 1.55, totalSd: 1.1, minScore: 0, granularity: 1 },
    marginPer100Elo: 0.56,
    ratingPriorBlendWithScoreBaseline: 0.42,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.12,
    minMean: 0.15,
    netRatingShiftDivisor: 60,
    netRatingShiftCap: 0.9,
    trendMarginMultiplier: 1.1,
    trendMarginCap: 1,
    venueSplitMultiplier: 1.2,
    venueSplitCap: 1,
    maxVarianceMultiplier: 1.28,
    featureChecks: [
      ...commonScoreChecks,
      factorStatus("stakes", "Table stakes context", false),
      factorKeyIncludesStatus("rest", "Fixture/rest congestion", false),
    ],
  },
  UCL: {
    sport: "UCL",
    engineLabel: "UCL knockout/travel proxy",
    scoringUnit: "goals",
    baseline: { total: 3.0, totalMin: 1.5, totalMax: 4.8, marginSd: 1.65, totalSd: 1.2, minScore: 0, granularity: 1 },
    marginPer100Elo: 0.6,
    ratingPriorBlendWithScoreBaseline: 0.42,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.12,
    minMean: 0.15,
    netRatingShiftDivisor: 60,
    netRatingShiftCap: 0.9,
    trendMarginMultiplier: 1.1,
    trendMarginCap: 1,
    venueSplitMultiplier: 1.2,
    venueSplitCap: 1,
    maxVarianceMultiplier: 1.28,
    featureChecks: [
      ...commonScoreChecks,
      factorStatus("ucl_pedigree", "UCL pedigree", true),
      factorStatus("ucl_travel", "UCL travel", false),
    ],
  },
  IPL: {
    sport: "IPL",
    engineLabel: "IPL T20 innings/run-rate model",
    scoringUnit: "runs",
    baseline: { total: 320, totalMin: 245, totalMax: 430, marginSd: 36, totalSd: 44, minScore: 80, granularity: 1 },
    marginPer100Elo: 15,
    ratingPriorBlendWithScoreBaseline: 0.44,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 3,
    minMean: 80,
    netRatingShiftDivisor: 42,
    netRatingShiftCap: 9,
    trendMarginMultiplier: 1.2,
    trendMarginCap: 12,
    venueSplitMultiplier: 16,
    venueSplitCap: 14,
    maxVarianceMultiplier: 1.22,
    featureChecks: [
      ...commonScoreChecks,
      factorStatus("ipl_table_strength", "Table strength", true),
      factorStatus("ipl_batting_trend", "Batting form", true),
      factorStatus("ipl_bowling_trend", "Bowling form", true),
      factorStatus("ipl_venue_split", "Venue split", false),
      factorStatus("ipl_conditions", "Venue/conditions", false),
    ],
  },
  TENNIS: {
    sport: "TENNIS",
    engineLabel: "Tennis match-game projection model",
    scoringUnit: "games",
    baseline: { total: 24.0, totalMin: 16.0, totalMax: 38.0, marginSd: 4.2, totalSd: 3.6, minScore: 6, granularity: 0.1 },
    marginPer100Elo: 2.8,
    ratingPriorBlendWithScoreBaseline: 0.35,
    ratingPriorBlendWithoutScoreBaseline: 1,
    meaningfulMarginThreshold: 0.8,
    minMean: 6,
    netRatingShiftDivisor: 22,
    netRatingShiftCap: 4.5,
    trendMarginMultiplier: 3.2,
    trendMarginCap: 3.5,
    venueSplitMultiplier: 2.8,
    venueSplitCap: 2.5,
    maxVarianceMultiplier: 1.35,
    featureChecks: [
      factorStatus("tennis_ranking_edge", "Ranking edge", true),
      factorStatus("tennis_recent_form", "Recent form", true),
      factorStatus("tennis_round_pressure", "Round/tournament pressure", false),
      factorStatus("tennis_match_format", "Match format", true),
      factorStatus("tennis_conditions", "Surface/weather conditions", false),
      (ctx) => marketStatus(ctx),
    ],
  },
};

export function getSportSimulationProfile(sport: string): SportSimulationProfile {
  return PROFILES[sport] ?? PROFILES.NBA!;
}

export function evaluateSimulationReadiness(
  ctx: GameContext,
  factors: FactorContribution[],
): SimulationReadiness {
  const profile = getSportSimulationProfile(ctx.sport);
  const statuses = profile.featureChecks.map((check) => check(ctx, factors));
  const totalWeight = statuses.reduce((sum, status) => sum + (status.critical ? 1.5 : 1), 0);
  const availableWeight = statuses
    .filter((status) => status.available)
    .reduce((sum, status) => sum + (status.critical ? 1.5 : 1), 0);
  const score = totalWeight > 0 ? availableWeight / totalWeight : 1;
  const missingCritical = statuses.filter((status) => status.critical && !status.available);
  const missingSupporting = statuses.filter((status) => !status.critical && !status.available);
  const missingPenalty = missingCritical.length * 0.035 + missingSupporting.length * 0.012;
  const coveragePenalty = Math.max(0, 1 - score) * 0.18;
  const varianceMultiplier = clamp(
    1 + missingPenalty + coveragePenalty,
    1,
    profile.maxVarianceMultiplier,
  );
  const totalVarianceMultiplier = clamp(
    1 + missingPenalty * 0.7 + coveragePenalty * 0.6,
    1,
    profile.maxVarianceMultiplier,
  );

  const active = statuses.filter((status) => status.available).length;
  const signals: ProjectionSignal[] = [
    {
      key: "simulation-profile",
      label: "League simulation profile",
      value: round(score),
      evidence: `${profile.engineLabel}: ${active}/${statuses.length} required/supporting inputs active`,
    },
  ];

  if (missingCritical.length > 0) {
    signals.push({
      key: "simulation-feature-gap",
      label: "Simulation input gap",
      value: -missingCritical.length,
      evidence:
        `${missingCritical.slice(0, 3).map((status) => status.label).join(", ")} missing; ` +
        "variance widened instead of fabricating inputs",
    });
  }

  return {
    profile,
    score: round(score),
    missingCritical,
    missingSupporting,
    varianceMultiplier: round(varianceMultiplier),
    totalVarianceMultiplier: round(totalVarianceMultiplier),
    signals,
  };
}
