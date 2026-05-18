import { describe, expect, test } from "bun:test";
import {
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

describe("updateLivePrediction", () => {
  test("blends late live score signal into the served prediction", () => {
    const pregame = makePrediction("Pregame read favors the home side.");

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

    expect(liveAdjusted.predictedWinner).toBe("away");
    expect(liveAdjusted.awayWinProbability).toBeGreaterThan(liveAdjusted.homeWinProbability);
    expect(liveAdjusted.confidence).toBe(liveAdjusted.awayWinProbability);
    expect(liveAdjusted.analysis).toContain("[LIVE Q4: 88");
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

  test("uses soccer count-up clock instead of treating match minute as a period", () => {
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

    expect(liveAdjusted.homeWinProbability).toBeLessThan(70);
    expect(total).toBeCloseTo(100, 1);
    expect(liveAdjusted.drawProbability).toBeDefined();
    expect(liveAdjusted.analysis).toContain("[LIVE 23': 1-0");
  });

  test("keeps soccer live home-away-draw probabilities coherent when draw is most likely", () => {
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

    expect(total).toBeCloseTo(100, 1);
    expect(liveAdjusted.predictedOutcome).toBe("draw");
    expect(liveAdjusted.drawProbability).toBeDefined();
    expect(liveAdjusted.confidence).toBe(liveAdjusted.drawProbability!);
  });
});
