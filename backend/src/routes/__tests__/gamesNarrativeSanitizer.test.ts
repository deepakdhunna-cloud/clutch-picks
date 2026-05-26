import { describe, expect, test } from "bun:test";
import {
  attachPredictionToGame,
  buildStoredPregamePrediction,
  isTopPickEligible,
  selectTopPicksForDisplay,
  shouldPromotePredictionUpdate,
  sanitizePredictionForGame,
  updateLivePrediction,
  type Game,
  type GamePrediction,
} from "../games";

function makeGame(): Game {
  return {
    id: "lal-okc",
    sport: "NBA",
    homeTeam: {
      id: "lal",
      name: "Los Angeles Lakers",
      abbreviation: "LAL",
      city: "Los Angeles",
      record: "53-29",
      color: "#552583",
    },
    awayTeam: {
      id: "okc",
      name: "Oklahoma City Thunder",
      abbreviation: "OKC",
      city: "Oklahoma City",
      record: "58-24",
      color: "#007AC1",
    },
    gameTime: "2026-05-11T21:30:00.000Z",
    status: "SCHEDULED",
    venue: "crypto.com Arena",
    seasonContext: {
      phase: "playoffs",
      label: "NBA playoff window",
      detail: "This falls in the NBA playoff window, so regular-season numbers are background and the pick should lean on repeatable matchup edges.",
      source: "date",
    },
  };
}

function makePrediction(analysis: string): GamePrediction {
  return {
    id: "pred-lal-okc",
    gameId: "lal-okc",
    predictedWinner: "home",
    confidence: 59,
    analysis,
    predictedSpread: 0,
    predictedTotal: 0,
    marketFavorite: "home",
    spread: 0,
    overUnder: 0,
    createdAt: "2026-05-11T12:00:00.000Z",
    homeWinProbability: 59,
    awayWinProbability: 41,
    factors: [
      {
        name: "Elo rating differential",
        weight: 0.4,
        homeScore: 0.985,
        awayScore: 0.015,
        description: "Home LAL Elo 1556 + 100 HFA vs Away OKC Elo 1560 = 97 pt differential",
      },
      {
        name: "Recent form (L10)",
        weight: 0.1,
        homeScore: 0.275,
        awayScore: 0.725,
        description: "Home L10: 4-5 (44%), Away L10: 7-0 (100%)",
      },
    ],
    edgeRating: 0,
    valueRating: 0,
    recentFormHome: "4-5",
    recentFormAway: "7-0",
    homeStreak: 0,
    awayStreak: 7,
    isTossUp: false,
  };
}

type CanonicalResult = NonNullable<GamePrediction["canonicalResult"]>;
type DecisionProfile = NonNullable<CanonicalResult["decisionProfile"]>;

function makeDecisionProfile(overrides: Partial<DecisionProfile> = {}): DecisionProfile {
  return {
    version: "unified-decision-profile-v1",
    pick: "home",
    probability: 0.59,
    confidence: 59,
    dataCoverage: 0.85,
    signalCoverage: 0.7,
    agreementScore: 82,
    hiddenEdgeScore: 30,
    upsetScore: 12,
    riskScore: 25,
    edgeRating: 2,
    valueRating: 1,
    lowDataWarning: false,
    engineDivergence: false,
    factorPick: "home",
    projectionPick: "home",
    tags: ["model-consensus"],
    thesis: [],
    watchouts: [],
    ...overrides,
  };
}

function makeCanonicalResult(overrides: Partial<CanonicalResult> = {}): CanonicalResult {
  return {
    eventId: "lal-okc",
    marketType: "moneyline",
    finalPick: "home",
    finalProbability: 0.59,
    confidence: 59,
    probabilities: { home: 0.59, away: 0.41 },
    decisionProfile: makeDecisionProfile(),
    modelInputs: {
      sport: "NBA",
      homeTeamId: "lal",
      awayTeamId: "okc",
      gameTime: "2026-05-11T21:30:00.000Z",
      factorCount: 5,
      availableFactorCount: 5,
      marketConsensusIncluded: true,
    },
    engineBreakdown: [],
    reconciliation: { method: "test", notes: [] },
    timestamp: "2026-05-11T12:00:00.000Z",
    dataVersion: "test",
    warnings: [],
    ...overrides,
  };
}

function makeTopPickPrediction(overrides: Partial<GamePrediction> = {}): GamePrediction {
  return {
    ...makePrediction("Professional-grade read with enough source support."),
    canonicalResult: makeCanonicalResult(),
    ...overrides,
  };
}

function makeSportGame(id: string, sport: Game["sport"], home: string, away: string): Game {
  const base = makeGame();
  return {
    ...base,
    id,
    sport,
    homeTeam: {
      ...base.homeTeam,
      id: `${id}-home`,
      name: `${home} Team`,
      abbreviation: home,
      city: home,
    },
    awayTeam: {
      ...base.awayTeam,
      id: `${id}-away`,
      name: `${away} Team`,
      abbreviation: away,
      city: away,
    },
  };
}

function attachTopPick(game: Game, confidence: number, tags: DecisionProfile["tags"] = ["model-consensus"]): Game {
  const probability = confidence / 100;
  return attachPredictionToGame(
    game,
    makeTopPickPrediction({
      id: `pred-${game.id}`,
      gameId: game.id,
      confidence,
      homeWinProbability: probability,
      awayWinProbability: 1 - probability,
      edgeRating: confidence >= 60 ? 7 : 5,
      valueRating: confidence >= 60 ? 7 : 5,
      canonicalResult: makeCanonicalResult({
        eventId: game.id,
        confidence,
        finalProbability: probability,
        probabilities: { home: probability, away: 1 - probability },
        decisionProfile: makeDecisionProfile({
          confidence,
          probability,
          tags,
        }),
        modelInputs: {
          ...makeCanonicalResult().modelInputs,
          sport: game.sport,
          homeTeamId: game.homeTeam.id,
          awayTeamId: game.awayTeam.id,
          gameTime: game.gameTime,
        },
      }),
    }),
  );
}

describe("sanitizePredictionForGame", () => {
  test("rewrites stale NBA raw-factor narratives before they reach cards", () => {
    const stale =
      "The data points toward LAL over OKC with clear separation. The biggest driver: Home LAL Elo 1556 + 100 HFA vs Away OKC Elo 1560 = 97 pt differential. Recent form (L10): Home L10: 4-5 (44%), Away L10: 7-0 (100%). Working against the pick: recent form (l10) favors OKC.";

    const sanitized = sanitizePredictionForGame(makeGame(), makePrediction(stale));

    expect(sanitized.analysis).toContain("Los Angeles Lakers");
    expect(sanitized.analysis).toContain("Oklahoma City Thunder");
    expect(sanitized.analysis.toLowerCase()).toContain("playoff");
    expect(sanitized.analysis).not.toContain("The data points toward");
    expect(sanitized.analysis).not.toContain("The biggest driver");
    expect(sanitized.analysis).not.toContain("Home LAL Elo");
    expect(sanitized.analysis).not.toContain("Home L10");
  });

  test("leaves already-human NBA narratives alone", () => {
    const clean =
      "The Los Angeles Lakers are the lean because the home setup gives them a cleaner path. Oklahoma City still has a real counter through recent form, so this is not a runaway read.";
    const original = makePrediction(clean);

    expect(sanitizePredictionForGame(makeGame(), original)).toBe(original);
  });

  test("rewrites raw-factor narratives for non-NBA sports too", () => {
    const game: Game = { ...makeGame(), sport: "MLB" };
    const stale =
      "The model points toward LAL. The biggest driver: Home LAL Elo 1556 + 100 HFA vs Away OKC Elo 1560 = 97 pt differential.";

    const sanitized = sanitizePredictionForGame(game, makePrediction(stale));

    expect(sanitized.analysis).toContain("Los Angeles Lakers");
    expect(sanitized.analysis).not.toContain("The model");
    expect(sanitized.analysis).not.toContain("Home LAL Elo");
  });
});

describe("attachPredictionToGame", () => {
  test("does not invent market odds when the game feed has none", () => {
    const game = makeGame();
    const prediction = makePrediction("Stable pregame read.");

    const attached = attachPredictionToGame(game, prediction);

    expect(attached.prediction).toBeDefined();
    expect(attached.spread).toBeUndefined();
    expect(attached.overUnder).toBeUndefined();
    expect(attached.marketFavorite).toBeUndefined();
  });

  test("preserves real market odds from the game feed", () => {
    const game: Game = {
      ...makeGame(),
      spread: -4.5,
      overUnder: 218.5,
      marketFavorite: "home",
    };
    const prediction = makePrediction("Stable pregame read.");

    const attached = attachPredictionToGame(game, prediction);

    expect(attached.spread).toBe(-4.5);
    expect(attached.overUnder).toBe(218.5);
    expect(attached.marketFavorite).toBe("home");
  });

  test("does not rewrite the public pick from live IPL chase state", () => {
    const game: Game = {
      ...makeGame(),
      sport: "IPL",
      status: "LIVE",
      homeTeam: {
        ...makeGame().homeTeam,
        abbreviation: "CSK",
        name: "Chennai Super Kings",
      },
      awayTeam: {
        ...makeGame().awayTeam,
        abbreviation: "MI",
        name: "Mumbai Indians",
      },
      cricketState: {
        home: { runs: 170, wickets: 6, overs: 20, maxOvers: 20, scoreText: "170/6" },
        away: { runs: 95, wickets: 2, overs: 9, maxOvers: 20, isBatting: true, scoreText: "95/2" },
        battingSide: "away",
        target: 171,
      },
    };
    const pregame = makePrediction("Pregame read favors the home side.");

    const attached = attachPredictionToGame(game, pregame);

    expect(attached.prediction?.predictedWinner).toBe("home");
    expect(attached.prediction?.confidence).toBe(59);
    expect(attached.prediction?.analysis).toBe("Pregame read favors the home side.");
    expect(attached.prediction?.canonicalResult?.finalPick).toBe("home");
    expect(attached.prediction?.canonicalResult?.engineBreakdown.some((read) => read.engine === "live-ipl-chase-v1")).toBe(false);
  });
});

describe("isTopPickEligible", () => {
  test("allows only scheduled canonical predictions with enough conviction", () => {
    const game = attachPredictionToGame(makeGame(), makeTopPickPrediction());

    expect(isTopPickEligible(game)).toBe(true);
  });

  test("rejects thin-data and low-conviction reads", () => {
    const thinData = attachPredictionToGame(
      makeGame(),
      makeTopPickPrediction({
        canonicalResult: makeCanonicalResult({
          decisionProfile: makeDecisionProfile({
            lowDataWarning: true,
            tags: ["thin-data"],
          }),
          warnings: ["League reliability reserve active because critical context is missing."],
        }),
      }),
    );
    const lowConviction = attachPredictionToGame(
      makeGame(),
      makeTopPickPrediction({
        confidence: 53,
        canonicalResult: makeCanonicalResult({
          confidence: 53,
          finalProbability: 0.53,
          probabilities: { home: 0.53, away: 0.47 },
          decisionProfile: makeDecisionProfile({
            confidence: 53,
            probability: 0.53,
            tags: ["low-conviction"],
          }),
        }),
      }),
    );

    expect(isTopPickEligible(thinData)).toBe(false);
    expect(isTopPickEligible(lowConviction)).toBe(false);
  });

  test("rejects live games and stored snapshots", () => {
    const live = attachPredictionToGame(
      { ...makeGame(), status: "LIVE" },
      makeTopPickPrediction(),
    );
    const stored = attachPredictionToGame(
      makeGame(),
      makeTopPickPrediction({ snapshotType: "stored-pregame" }),
    );

    expect(isTopPickEligible(live)).toBe(false);
    expect(isTopPickEligible(stored)).toBe(false);
  });
});

describe("selectTopPicksForDisplay", () => {
  test("returns the best scheduled pick per sport and falls back when strict gates reject a sport", () => {
    const nba = attachTopPick(makeSportGame("nba-1", "NBA", "LAL", "OKC"), 62);
    const mlbWeak = attachTopPick(makeSportGame("mlb-1", "MLB", "NYY", "BOS"), 58);
    const mlbStrong = attachTopPick(makeSportGame("mlb-2", "MLB", "LAD", "SF"), 66);
    const nhlLowConviction = attachTopPick(
      makeSportGame("nhl-1", "NHL", "DAL", "EDM"),
      53,
      ["low-conviction"],
    );

    const selected = selectTopPicksForDisplay([mlbWeak, nhlLowConviction, mlbStrong, nba]);

    expect(selected.map((game) => game.id)).toEqual(["nba-1", "mlb-2", "nhl-1"]);
  });
});

describe("buildStoredPregamePrediction", () => {
  test("preserves the original settled prediction instead of replaying the current engine", () => {
    const row = {
      id: "row-1",
      gameId: "lal-okc",
      sport: "NBA",
      scheduledStart: new Date("2026-05-11T21:30:00.000Z"),
      homeTeam: "LAL",
      awayTeam: "OKC",
      predictedWinner: "home",
      predictedOutcome: "home",
      actualWinner: "away",
      actualOutcome: "away",
      confidence: 55,
      isTossUp: false,
      wasCorrect: false,
      homeElo: 1595,
      awayElo: 1538,
      homeWinProb: 0.5454,
      awayWinProb: 0.4546,
      drawProb: null,
      modelVersion: "2.6.0-neutral-factor-projection-truth",
      selectedOutcomeProb: 0.5454,
      brierScore: 0.2975,
      logLoss: 0.7869,
      finalHomeScore: 93,
      finalAwayScore: 130,
      marketHomeProb: null,
      marketAwayProb: null,
      marketDrawProb: null,
      marketDivergence: null,
      dataCoverage: 0.875,
      signalCoverage: 0.375,
      agreementScore: null,
      edgeRating: 2,
      valueRating: 1,
      riskScore: null,
      tagsJson: null,
      dataSourcesJson: null,
      gradeVersion: "test",
      gradedAt: new Date("2026-05-12T02:00:00.000Z"),
      settledBy: "test",
      createdAt: new Date("2026-05-11T12:00:00.000Z"),
      resolvedAt: new Date("2026-05-12T02:00:00.000Z"),
    };

    const prediction = buildStoredPregamePrediction(makeGame(), row);

    expect(prediction.snapshotType).toBe("stored-pregame");
    expect(prediction.predictedWinner).toBe("home");
    expect(prediction.wasCorrect).toBe(false);
    expect(prediction.actualOutcome).toBe("away");
    expect(prediction.homeWinProbability).toBeCloseTo(54.5, 1);
    expect(prediction.analysis).toContain("The pregame model favored Los Angeles Lakers");
    expect(prediction.analysis).toContain("before tipoff");
    expect(prediction.analysis).toContain("locked");
    expect(prediction.analysis).not.toContain("Stored pregame prediction");
    expect(prediction.analysis).not.toContain("2.6.0-neutral-factor-projection-truth");
    expect(prediction.canonicalResult?.finalPick).toBe("home");
    expect(prediction.canonicalResult?.dataVersion).toBe("2.6.0-neutral-factor-projection-truth");
    expect(prediction.canonicalResult?.warnings).toContain("Stored pregame prediction snapshot; not recomputed after final.");
  });
});

describe("shouldPromotePredictionUpdate", () => {
  test("keeps the prior prediction when a fresh run only nudges the numbers", () => {
    const previous: GamePrediction = {
      ...makePrediction("Stable pregame read."),
      projection: {
        engine: "game-script-v1",
        iterations: 50000,
        homeWinProbability: 59,
        awayWinProbability: 41,
        projectedHomeScore: 112,
        projectedAwayScore: 108,
        projectedSpread: 4,
        projectedTotal: 220,
        volatility: 0.2,
        upsetRisk: 0.41,
        signals: [],
      },
    };
    const candidate: GamePrediction = {
      ...previous,
      confidence: 60,
      homeWinProbability: 60,
      awayWinProbability: 40,
      projection: {
        ...previous.projection!,
        homeWinProbability: 60,
        awayWinProbability: 40,
        projectedHomeScore: 112.4,
        projectedAwayScore: 108.1,
        projectedSpread: 4.3,
        projectedTotal: 220.5,
      },
    };

    expect(shouldPromotePredictionUpdate(makeGame(), previous, candidate)).toBe(false);
  });

  test("promotes meaningful probability or projection moves", () => {
    const previous = makePrediction("Stable pregame read.");
    const candidate: GamePrediction = {
      ...previous,
      confidence: 64,
      homeWinProbability: 64,
      awayWinProbability: 36,
    };

    expect(shouldPromotePredictionUpdate(makeGame(), previous, candidate)).toBe(true);
  });

  test("requires a clear edge before replacing the visible pick with a flipped side", () => {
    const previous: GamePrediction = {
      ...makePrediction("Pregame read favors the home side."),
      confidence: 52,
      homeWinProbability: 52,
      awayWinProbability: 48,
    };
    const noisyFlip: GamePrediction = {
      ...previous,
      predictedWinner: "away",
      predictedOutcome: "away",
      confidence: 51,
      homeWinProbability: 49,
      awayWinProbability: 51,
    };
    const clearFlip: GamePrediction = {
      ...noisyFlip,
      confidence: 56,
      homeWinProbability: 44,
      awayWinProbability: 56,
    };

    expect(shouldPromotePredictionUpdate(makeGame(), previous, noisyFlip)).toBe(false);
    expect(shouldPromotePredictionUpdate(makeGame(), previous, clearFlip)).toBe(true);
  });

  test("never promotes prediction changes after the game starts", () => {
    const previous = makePrediction("Pregame read favors the home side.");
    const liveCandidate: GamePrediction = {
      ...previous,
      predictedWinner: "away",
      predictedOutcome: "away",
      confidence: 84,
      homeWinProbability: 16,
      awayWinProbability: 84,
    };

    expect(shouldPromotePredictionUpdate({ ...makeGame(), status: "LIVE" }, previous, liveCandidate)).toBe(false);
    expect(shouldPromotePredictionUpdate({ ...makeGame(), status: "FINAL" }, previous, liveCandidate)).toBe(false);
  });
});

describe("updateLivePrediction", () => {
  test("keeps the model prediction stable during late live score swings", () => {
    const pregame: GamePrediction = {
      ...makePrediction("Pregame read favors the home side."),
      projection: {
        engine: "game-script-v1",
        iterations: 50000,
        homeWinProbability: 59,
        awayWinProbability: 41,
        projectedHomeScore: 112,
        projectedAwayScore: 108,
        projectedSpread: 4,
        projectedTotal: 220,
        volatility: 0.2,
        upsetRisk: 0.41,
        signals: [],
      },
    };

    const liveAdjusted = updateLivePrediction(
      pregame,
      {
        currentHomeScore: 88,
        currentAwayScore: 104,
        period: 4,
        clockSeconds: 180,
        totalPeriods: 4,
      },
      "NBA",
    );

    expect(liveAdjusted).toBe(pregame);
    expect(liveAdjusted.predictedWinner).toBe("home");
    expect(liveAdjusted.homeWinProbability).toBe(59);
    expect(liveAdjusted.awayWinProbability).toBe(41);
    expect(liveAdjusted.analysis).not.toContain("[LIVE");
  });

  test("does not distort very early live games", () => {
    const pregame = makePrediction("Pregame read favors the home side.");

    const liveAdjusted = updateLivePrediction(
      pregame,
      {
        currentHomeScore: 2,
        currentAwayScore: 0,
        period: 1,
        clockSeconds: 660,
        totalPeriods: 4,
      },
      "NBA",
    );

    expect(liveAdjusted).toBe(pregame);
  });

  test("does not let soccer live score rewrite the pregame three-way probabilities", () => {
    const pregame: GamePrediction = {
      ...makePrediction("Pregame read has a narrow home lean."),
      predictedOutcome: "home",
      homeWinProbability: 40,
      awayWinProbability: 35,
      drawProbability: 25,
      confidence: 40,
    };

    const liveAdjusted = updateLivePrediction(
      pregame,
      {
        currentHomeScore: 1,
        currentAwayScore: 0,
        period: 23,
        clockSeconds: null,
        elapsedSeconds: 23 * 60,
        totalPeriods: 2,
      },
      "EPL",
    );

    const total =
      liveAdjusted.homeWinProbability +
      liveAdjusted.awayWinProbability +
      (liveAdjusted.drawProbability ?? 0);

    expect(liveAdjusted).toBe(pregame);
    expect(liveAdjusted.homeWinProbability).toBe(40);
    expect(liveAdjusted.awayWinProbability).toBe(35);
    expect(liveAdjusted.drawProbability).toBe(25);
    expect(total).toBeCloseTo(100, 1);
    expect(liveAdjusted.analysis).not.toContain("[LIVE");
  });

  test("does not flip soccer picks to draw because of live match state", () => {
    const pregame: GamePrediction = {
      ...makePrediction("Pregame read has a narrow home lean."),
      predictedOutcome: "home",
      homeWinProbability: 45,
      awayWinProbability: 30,
      drawProbability: 25,
      confidence: 45,
    };

    const liveAdjusted = updateLivePrediction(
      pregame,
      {
        currentHomeScore: 1,
        currentAwayScore: 1,
        period: 2,
        clockSeconds: null,
        elapsedSeconds: 80 * 60,
        totalPeriods: 2,
      },
      "UCL",
    );

    const total =
      liveAdjusted.homeWinProbability +
      liveAdjusted.awayWinProbability +
      (liveAdjusted.drawProbability ?? 0);

    expect(liveAdjusted).toBe(pregame);
    expect(total).toBeCloseTo(100, 1);
    expect(liveAdjusted.predictedOutcome).toBe("home");
    expect(liveAdjusted.drawProbability).toBeDefined();
    expect(liveAdjusted.confidence).toBe(45);
  });
});
