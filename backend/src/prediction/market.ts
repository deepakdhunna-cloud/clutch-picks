import type { MarketConsensus, MarketLine } from "../lib/sharpApi";

type MarketFavorite = "home" | "away";

type MarketProfile = {
  marginSd: number;
  defaultFavoriteProbability: number;
  minFavoriteProbability: number;
  maxFavoriteProbability: number;
};

const MARKET_PROFILES: Record<string, MarketProfile> = {
  NBA: {
    marginSd: 12.5,
    defaultFavoriteProbability: 0.535,
    minFavoriteProbability: 0.515,
    maxFavoriteProbability: 0.78,
  },
  NCAAB: {
    marginSd: 10.5,
    defaultFavoriteProbability: 0.535,
    minFavoriteProbability: 0.515,
    maxFavoriteProbability: 0.78,
  },
  NFL: {
    marginSd: 13.5,
    defaultFavoriteProbability: 0.535,
    minFavoriteProbability: 0.515,
    maxFavoriteProbability: 0.76,
  },
  NCAAF: {
    marginSd: 16,
    defaultFavoriteProbability: 0.535,
    minFavoriteProbability: 0.515,
    maxFavoriteProbability: 0.78,
  },
  MLB: {
    marginSd: 3.2,
    defaultFavoriteProbability: 0.535,
    minFavoriteProbability: 0.515,
    maxFavoriteProbability: 0.72,
  },
  NHL: {
    marginSd: 2.2,
    defaultFavoriteProbability: 0.535,
    minFavoriteProbability: 0.515,
    maxFavoriteProbability: 0.72,
  },
  MLS: {
    marginSd: 1.55,
    defaultFavoriteProbability: 0.525,
    minFavoriteProbability: 0.51,
    maxFavoriteProbability: 0.66,
  },
  EPL: {
    marginSd: 1.55,
    defaultFavoriteProbability: 0.525,
    minFavoriteProbability: 0.51,
    maxFavoriteProbability: 0.66,
  },
  UCL: {
    marginSd: 1.65,
    defaultFavoriteProbability: 0.525,
    minFavoriteProbability: 0.51,
    maxFavoriteProbability: 0.66,
  },
  IPL: {
    marginSd: 36,
    defaultFavoriteProbability: 0.535,
    minFavoriteProbability: 0.515,
    maxFavoriteProbability: 0.72,
  },
  TENNIS: {
    marginSd: 0.85,
    defaultFavoriteProbability: 0.535,
    minFavoriteProbability: 0.515,
    maxFavoriteProbability: 0.72,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function americanFromProbability(probability: number): number {
  const p = clamp(probability, 0.01, 0.99);
  if (p >= 0.5) return Math.round((-100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

function marketLineFromProbabilities(args: {
  homeProbability: number;
  awayProbability: number;
  fetchedAt: string;
}): MarketLine {
  const homeAmerican = americanFromProbability(args.homeProbability);
  const awayAmerican = americanFromProbability(args.awayProbability);
  return {
    sportsbook: "ESPN odds fallback",
    homeAmerican,
    awayAmerican,
    homeDecimal: round(1 / args.homeProbability, 3),
    awayDecimal: round(1 / args.awayProbability, 3),
    homeImpliedProb: args.homeProbability,
    awayImpliedProb: args.awayProbability,
    fetchedAt: args.fetchedAt,
  };
}

function favoriteProbabilityFromSpread(
  sport: string,
  spread: number | undefined,
): number {
  const profile = MARKET_PROFILES[sport] ?? MARKET_PROFILES.NBA!;
  if (typeof spread !== "number" || !Number.isFinite(spread) || Math.abs(spread) < 0.1) {
    return profile.defaultFavoriteProbability;
  }

  const probability = normalCdf(Math.abs(spread) / profile.marginSd);
  return clamp(
    probability,
    profile.minFavoriteProbability,
    profile.maxFavoriteProbability,
  );
}

export function buildMarketConsensusFromGameOdds(args: {
  sport: string;
  marketFavorite?: MarketFavorite;
  spread?: number;
  overUnder?: number;
  fetchedAt?: string;
}): MarketConsensus | null {
  if (!args.marketFavorite) return null;

  const favoriteProbability = favoriteProbabilityFromSpread(args.sport, args.spread);
  const homeProbability =
    args.marketFavorite === "home"
      ? favoriteProbability
      : 1 - favoriteProbability;
  const awayProbability = 1 - homeProbability;
  const fetchedAt = args.fetchedAt ?? new Date().toISOString();
  const line = marketLineFromProbabilities({
    homeProbability,
    awayProbability,
    fetchedAt,
  });

  return {
    lines: [line],
    pinnacleLine: null,
    noVigHomeProb: round(homeProbability),
    noVigAwayProb: round(awayProbability),
    avgHomeProb: round(homeProbability),
    avgAwayProb: round(awayProbability),
    source: "espn-odds",
    sourceLabel: "ESPN odds fallback",
    isFallback: true,
    marketFavorite: args.marketFavorite,
    spread: args.spread,
    overUnder: args.overUnder,
  };
}
