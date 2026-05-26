type Side = "home" | "away";

type LiveIplInnings = {
  runs?: number;
  wickets?: number;
  overs?: number;
  maxOvers?: number;
  isBatting?: boolean;
  scoreText?: string;
};

type LiveIplGameLike = {
  sport: string;
  status?: string;
  homeTeam: { abbreviation: string };
  awayTeam: { abbreviation: string };
  homeScore?: number;
  awayScore?: number;
  cricketState?: {
    home?: LiveIplInnings;
    away?: LiveIplInnings;
    battingSide?: Side;
    target?: number;
  };
};

export type LiveIplChaseRead = {
  engine: "live-ipl-chase-v1";
  battingSide: Side;
  defendingSide: Side;
  pick: Side;
  homeWinProbability: number;
  awayWinProbability: number;
  confidence: number;
  target: number;
  runsNeeded: number;
  ballsRemaining: number;
  requiredRunRate: number;
  currentRunRate: number;
  wicketsLost: number;
  wicketsInHand: number;
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedSpread: number;
  projectedTotal: number;
  evidence: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sideRuns(game: LiveIplGameLike, side: Side): number | undefined {
  return game.cricketState?.[side]?.runs ?? (side === "home" ? game.homeScore : game.awayScore);
}

function oppositeSide(side: Side): Side {
  return side === "home" ? "away" : "home";
}

function oversToBalls(overs: number | undefined): number | null {
  if (typeof overs !== "number" || !Number.isFinite(overs) || overs < 0) return null;
  const completedOvers = Math.trunc(overs);
  const ballsInCurrentOver = Math.min(5, Math.max(0, Math.round((overs - completedOvers) * 10)));
  return completedOvers * 6 + ballsInCurrentOver;
}

function ballsLimit(maxOvers: number | undefined): number {
  return Math.round((maxOvers ?? 20) * 6);
}

function inningsComplete(innings: LiveIplInnings | undefined): boolean {
  if (!innings) return false;
  if (typeof innings.wickets === "number" && innings.wickets >= 10) return true;
  const ballsBowled = oversToBalls(innings.overs);
  return ballsBowled !== null && ballsBowled >= ballsLimit(innings.maxOvers);
}

function firstInningsSide(game: LiveIplGameLike): Side | null {
  const target = game.cricketState?.target;
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 1) return null;
  const firstInningsRuns = target - 1;
  const homeRuns = sideRuns(game, "home");
  const awayRuns = sideRuns(game, "away");

  if (homeRuns === firstInningsRuns && awayRuns !== firstInningsRuns) return "home";
  if (awayRuns === firstInningsRuns && homeRuns !== firstInningsRuns) return "away";
  if (inningsComplete(game.cricketState?.home) && !inningsComplete(game.cricketState?.away)) return "home";
  if (inningsComplete(game.cricketState?.away) && !inningsComplete(game.cricketState?.home)) return "away";
  return null;
}

function battingSide(game: LiveIplGameLike): Side | null {
  const first = firstInningsSide(game);
  if (first) return oppositeSide(first);

  const flagged = (["home", "away"] as const).filter((side) =>
    game.cricketState?.[side]?.isBatting === true && !inningsComplete(game.cricketState?.[side])
  );
  if (flagged.length === 1) return flagged[0] ?? null;
  return game.cricketState?.battingSide ?? null;
}

function scoreText(game: LiveIplGameLike, side: Side): string {
  const innings = game.cricketState?.[side];
  if (innings?.scoreText) return innings.scoreText;
  const runs = sideRuns(game, side);
  const wickets = innings?.wickets;
  if (typeof runs === "number" && typeof wickets === "number") return `${runs}/${wickets}`;
  return typeof runs === "number" ? String(runs) : "0";
}

function chaseProbability(args: {
  target: number;
  runs: number;
  wicketsLost: number;
  ballsBowled: number;
  ballsRemaining: number;
}): number {
  const runsNeeded = args.target - args.runs;
  if (runsNeeded <= 0) return 0.995;
  if (args.ballsRemaining <= 0 || args.wicketsLost >= 10) return 0.005;

  const requiredRunRate = (runsNeeded / args.ballsRemaining) * 6;
  const currentRunRate = args.ballsBowled > 0 ? (args.runs / args.ballsBowled) * 6 : 0;
  const wicketsInHand = clamp(10 - args.wicketsLost, 0, 10);
  const progress = clamp(args.ballsBowled / 120, 0, 1);

  const z =
    1.4 -
    0.55 * (requiredRunRate - 8.7) +
    0.12 * (currentRunRate - 8.7) +
    0.22 * (wicketsInHand - 5) -
    0.014 * Math.max(0, args.target - 190) +
    0.25 * (1 - progress);

  return clamp(1 / (1 + Math.exp(-z)), 0.03, 0.97);
}

function expectedRemainingRuns(args: {
  currentRunRate: number;
  requiredRunRate: number;
  wicketsInHand: number;
  ballsRemaining: number;
}): number {
  const pressurePenalty = Math.max(0, args.requiredRunRate - 10) * 0.18;
  const formBoost = Math.max(0, args.currentRunRate - 8.5) * 0.28;
  const wicketBoost = (args.wicketsInHand - 5) * 0.22;
  const projectedRunRate = clamp(8.6 + wicketBoost + formBoost - pressurePenalty, 5.2, 13.8);
  return (args.ballsRemaining / 6) * projectedRunRate;
}

export function computeLiveIplChaseRead(game: LiveIplGameLike): LiveIplChaseRead | null {
  if (game.sport !== "IPL" || game.status !== "LIVE") return null;

  const target = game.cricketState?.target;
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 1) return null;

  const batting = battingSide(game);
  if (!batting) return null;

  const defending = oppositeSide(batting);
  const battingInnings = game.cricketState?.[batting];
  if (!battingInnings) return null;

  const runs = sideRuns(game, batting);
  const wicketsLost = battingInnings.wickets ?? 0;
  const ballsBowled = oversToBalls(battingInnings.overs);
  if (typeof runs !== "number" || ballsBowled === null) return null;

  const inningsBalls = ballsLimit(battingInnings.maxOvers);
  const ballsRemaining = Math.max(0, inningsBalls - ballsBowled);
  const runsNeeded = target - runs;
  const requiredRunRate = ballsRemaining > 0 ? (runsNeeded / ballsRemaining) * 6 : Number.POSITIVE_INFINITY;
  const currentRunRate = ballsBowled > 0 ? (runs / ballsBowled) * 6 : 0;
  const wicketsInHand = clamp(10 - wicketsLost, 0, 10);
  const chaseProb = chaseProbability({
    target,
    runs,
    wicketsLost,
    ballsBowled,
    ballsRemaining,
  });

  const expectedChaseFinal =
    runs +
    expectedRemainingRuns({
      currentRunRate,
      requiredRunRate,
      wicketsInHand,
      ballsRemaining,
    });
  const projectedHomeScore = batting === "home"
    ? Math.min(Math.max(expectedChaseFinal, runs), target + 6)
    : sideRuns(game, "home") ?? 0;
  const projectedAwayScore = batting === "away"
    ? Math.min(Math.max(expectedChaseFinal, runs), target + 6)
    : sideRuns(game, "away") ?? 0;

  const homeWinProbability = batting === "home" ? chaseProb : 1 - chaseProb;
  const awayWinProbability = batting === "away" ? chaseProb : 1 - chaseProb;
  const pick: Side = homeWinProbability >= awayWinProbability ? "home" : "away";
  const defendingTeam = defending === "home" ? game.homeTeam.abbreviation : game.awayTeam.abbreviation;
  const battingTeam = batting === "home" ? game.homeTeam.abbreviation : game.awayTeam.abbreviation;

  return {
    engine: "live-ipl-chase-v1",
    battingSide: batting,
    defendingSide: defending,
    pick,
    homeWinProbability: round(homeWinProbability, 4),
    awayWinProbability: round(awayWinProbability, 4),
    confidence: round(Math.max(homeWinProbability, awayWinProbability) * 100, 1),
    target,
    runsNeeded,
    ballsRemaining,
    requiredRunRate: round(requiredRunRate, 2),
    currentRunRate: round(currentRunRate, 2),
    wicketsLost,
    wicketsInHand,
    projectedHomeScore: round(projectedHomeScore, 1),
    projectedAwayScore: round(projectedAwayScore, 1),
    projectedSpread: round(projectedHomeScore - projectedAwayScore, 1),
    projectedTotal: round(projectedHomeScore + projectedAwayScore, 1),
    evidence:
      `${battingTeam} ${scoreText(game, batting)} need ${Math.max(0, runsNeeded)} off ${ballsRemaining} balls ` +
      `(RRR ${round(requiredRunRate, 2)}) with ${wicketsInHand} wickets in hand; live chase read favors ` +
      `${pick === defending ? defendingTeam : battingTeam} at ${round(Math.max(homeWinProbability, awayWinProbability) * 100, 1)}%.`,
  };
}
