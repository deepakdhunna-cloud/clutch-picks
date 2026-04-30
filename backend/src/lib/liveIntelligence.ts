/**
 * Live-intelligence box assembler — pure function, no I/O.
 *
 * Given a game's current state, ESPN live snapshot, the user's pick (if any),
 * a market snapshot (if any), and the prediction-engine result, produce
 * exactly four "boxes" tailored to whether the game is pre / live / final.
 *
 * Box types are camelCase strings, callers can switch on `type` to pick a
 * UI template. `data` carries the raw values; `body` is a short human
 * sentence the frontend can show without computing anything.
 */

import type { HonestPrediction, FactorContribution } from "../prediction/types";
import type { EspnLive } from "./espnLive";
import type { MarketConsensus } from "./sharpApi";
import type { Game } from "../routes/games";

export type BoxType =
  | "prediction"
  | "topFactor"
  | "keyRisk"
  | "watchFor"
  | "winProbability"
  | "winProbabilityPlaceholder"
  | "leverageOrDecision"
  | "pickPressure"
  | "liveEdgeVsMarket"
  | "playerSpotlight"
  | "result"
  | "factorPostmortem"
  | "whatChanged"
  | "nextOpportunity";

export interface Box {
  type: BoxType;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export type GameState = "pre" | "live" | "final";

export interface UserPick {
  pickedTeam: "home" | "away";
  homeTeam?: string | null;
  awayTeam?: string | null;
}

export interface AssembleInput {
  game: GameContextLite;
  espn: EspnLive;
  userPick: UserPick | null;
  marketSnapshot: MarketConsensus | null;
  prediction: HonestPrediction;
  /** When provided, "nextOpportunity" can name a specific upcoming matchup. */
  nextGame?: Game | null;
}

/** Lighter game shape used by the assembler — just identity + matchup info. */
export interface GameContextLite {
  id: string;
  sport: string;
  state: GameState;
  homeTeam: { id: string; abbreviation: string; name: string };
  awayTeam: { id: string; abbreviation: string; name: string };
  homeScore?: number;
  awayScore?: number;
}

const SPORTS_WITH_LIVE_WP = new Set(["MLB", "NBA", "NHL"]);

// ─── Helpers ─────────────────────────────────────────────────────────────

function pickFavored(prediction: HonestPrediction): "home" | "away" | "draw" {
  if (
    prediction.drawProbability !== undefined &&
    prediction.drawProbability >= prediction.homeWinProbability &&
    prediction.drawProbability >= prediction.awayWinProbability
  ) {
    return "draw";
  }
  return prediction.homeWinProbability >= prediction.awayWinProbability ? "home" : "away";
}

function topAvailableFactor(factors: FactorContribution[]): FactorContribution | null {
  const available = factors.filter((f) => f.available && f.weight > 0);
  if (available.length === 0) return null;
  // Highest weighted absolute contribution = most influential factor.
  return available
    .slice()
    .sort((a, b) => Math.abs(b.homeDelta) * b.weight - Math.abs(a.homeDelta) * a.weight)[0]!;
}

function biggestRiskFactor(factors: FactorContribution[]): FactorContribution | null {
  // The factor most pulling against the predicted side. We treat the smallest
  // (most negative for home favorite, most positive for away favorite)
  // contribution as "the risk." For simplicity: pick the factor with the
  // largest |delta| that points opposite the leader.
  const available = factors.filter((f) => f.available && f.weight > 0);
  if (available.length === 0) return null;
  const leaderIsHome =
    available.reduce((acc, f) => acc + f.homeDelta * f.weight, 0) >= 0;
  const counters = available.filter((f) =>
    leaderIsHome ? f.homeDelta < 0 : f.homeDelta > 0,
  );
  if (counters.length === 0) return null;
  return counters
    .slice()
    .sort((a, b) => Math.abs(b.homeDelta) * b.weight - Math.abs(a.homeDelta) * a.weight)[0]!;
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

// ─── Pre-game boxes ──────────────────────────────────────────────────────

function preBoxes(input: AssembleInput): Box[] {
  const { prediction, game } = input;
  const favored = pickFavored(prediction);
  const homeAbbr = game.homeTeam.abbreviation;
  const awayAbbr = game.awayTeam.abbreviation;
  const winnerLabel =
    favored === "home" ? homeAbbr : favored === "away" ? awayAbbr : "Draw";

  const top = topAvailableFactor(prediction.factors);
  const risk = biggestRiskFactor(prediction.factors);

  const watchTargets: string[] = [];
  if (prediction.unavailableFactors.length > 0) {
    watchTargets.push(`Awaiting: ${prediction.unavailableFactors.slice(0, 2).join("; ")}`);
  }
  if (top) {
    watchTargets.push(`Pivots on: ${top.label}`);
  }

  return [
    {
      type: "prediction",
      title: "Model Prediction",
      body: `${winnerLabel} ${prediction.confidence.toFixed(1)}% (${prediction.confidenceBand})`,
      data: {
        predictedWinner: prediction.predictedWinner,
        homeWinProbability: prediction.homeWinProbability,
        awayWinProbability: prediction.awayWinProbability,
        drawProbability: prediction.drawProbability ?? null,
        confidence: prediction.confidence,
        confidenceBand: prediction.confidenceBand,
      },
    },
    {
      type: "topFactor",
      title: "Top Factor",
      body: top ? `${top.label}: ${top.evidence}` : "No standout factor — Elo carrying the pick",
      data: {
        factor: top
          ? {
              key: top.key,
              label: top.label,
              homeDelta: top.homeDelta,
              weight: top.weight,
              evidence: top.evidence,
            }
          : null,
      },
    },
    {
      type: "keyRisk",
      title: "Key Risk",
      body: risk
        ? `${risk.label} cuts the other way: ${risk.evidence}`
        : "No material counter-signal in the data",
      data: {
        factor: risk
          ? {
              key: risk.key,
              label: risk.label,
              homeDelta: risk.homeDelta,
              weight: risk.weight,
              evidence: risk.evidence,
            }
          : null,
      },
    },
    {
      type: "watchFor",
      title: "Watch For",
      body: watchTargets.length > 0 ? watchTargets.join(" · ") : "Lineup confirmations near tip-off",
      data: {
        unavailableFactors: prediction.unavailableFactors,
        watchTargets,
      },
    },
  ];
}

// ─── Live boxes ──────────────────────────────────────────────────────────

function liveBoxes(input: AssembleInput): Box[] {
  const { game, espn, prediction, userPick, marketSnapshot } = input;
  const sport = game.sport;
  const homeAbbr = game.homeTeam.abbreviation;
  const awayAbbr = game.awayTeam.abbreviation;

  // Box 0 — winProbability OR placeholder
  let wpBox: Box;
  if (SPORTS_WITH_LIVE_WP.has(sport) && espn.winProbability) {
    const wp = espn.winProbability;
    const leader = wp.home >= wp.away ? homeAbbr : awayAbbr;
    const leaderProb = Math.max(wp.home, wp.away);
    wpBox = {
      type: "winProbability",
      title: "Live Win Probability",
      body: `${leader} ${fmtPct(leaderProb)} — ${espn.situation || "in progress"}`,
      data: {
        homeWinProb: wp.home,
        awayWinProb: wp.away,
        drawWinProb: wp.draw ?? null,
        sparkline: espn.sparkline ?? [],
        situation: espn.situation,
      },
    };
  } else {
    wpBox = {
      type: "winProbabilityPlaceholder",
      title: "Live Win Probability",
      body: `Live WP not published for ${sport}. Score: ${homeAbbr} ${
        game.homeScore ?? 0
      } — ${awayAbbr} ${game.awayScore ?? 0}`,
      data: {
        reason: "sport-not-supported",
        homeScore: game.homeScore ?? 0,
        awayScore: game.awayScore ?? 0,
        situation: espn.situation,
      },
    };
  }

  // Box 1 — leverageOrDecision (MLB → leverage; others → decision moment)
  const leverageOrDecision: Box =
    sport === "MLB" && espn.leverageIndex !== null
      ? {
          type: "leverageOrDecision",
          title: "Leverage Index",
          body: `LI ${espn.leverageIndex.toFixed(2)} — ${espn.situation || "live"}`,
          data: {
            leverageIndex: espn.leverageIndex,
            situation: espn.situation,
            lastPlay: espn.lastPlay,
          },
        }
      : {
          type: "leverageOrDecision",
          title: "Decision Moment",
          body: espn.lastPlay || espn.situation || "Live game in progress",
          data: {
            lastPlay: espn.lastPlay,
            situation: espn.situation,
          },
        };

  // Box 2 — pickPressure (when user picked) OR liveEdgeVsMarket
  const usersPickBox: Box | null = userPick
    ? (() => {
        const pickedAbbr = userPick.pickedTeam === "home" ? homeAbbr : awayAbbr;
        const wp = espn.winProbability;
        const pickProb = wp
          ? userPick.pickedTeam === "home"
            ? wp.home
            : wp.away
          : null;
        return {
          type: "pickPressure",
          title: "Your Pick Pressure",
          body: pickProb !== null
            ? `${pickedAbbr} now ${fmtPct(pickProb)} — ${
                pickProb >= 0.5 ? "holding" : "trailing"
              }`
            : `${pickedAbbr} — live WP unavailable`,
          data: {
            pickedTeam: userPick.pickedTeam,
            pickedAbbr,
            currentProb: pickProb,
            situation: espn.situation,
          },
        };
      })()
    : null;

  const liveEdgeBox: Box = (() => {
    if (!marketSnapshot) {
      return {
        type: "liveEdgeVsMarket",
        title: "Live Edge vs Market",
        body: "No live line available",
        data: { hasLine: false },
      };
    }
    const modelHome = prediction.homeWinProbability;
    const marketHome = marketSnapshot.noVigHomeProb;
    const edge = modelHome - marketHome;
    return {
      type: "liveEdgeVsMarket",
      title: "Live Edge vs Market",
      body: `Model ${fmtPct(modelHome)} vs Market ${fmtPct(marketHome)} — edge ${(edge * 100).toFixed(1)}pp`,
      data: {
        hasLine: true,
        modelHomeProb: modelHome,
        marketHomeProb: marketHome,
        edgePercentagePoints: edge * 100,
      },
    };
  })();

  const middleBox = usersPickBox ?? liveEdgeBox;

  // Box 3 — playerSpotlight (next-up batter / hot player / situation)
  const spotlight: Box = {
    type: "playerSpotlight",
    title: "Player Spotlight",
    body: espn.nextUp
      ? `${espn.nextUp.name}${espn.nextUp.stat ? ` — ${espn.nextUp.stat}` : ""}`
      : espn.lastPlay || "No spotlight available",
    data: {
      nextUp: espn.nextUp,
      lastPlay: espn.lastPlay,
    },
  };

  return [wpBox, leverageOrDecision, middleBox, spotlight];
}

// ─── Final boxes ─────────────────────────────────────────────────────────

function finalBoxes(input: AssembleInput): Box[] {
  const { game, prediction, userPick, nextGame } = input;
  const homeAbbr = game.homeTeam.abbreviation;
  const awayAbbr = game.awayTeam.abbreviation;
  const homeScore = game.homeScore ?? 0;
  const awayScore = game.awayScore ?? 0;

  const winnerSide: "home" | "away" | "tie" =
    homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "tie";
  const winnerAbbr =
    winnerSide === "home" ? homeAbbr : winnerSide === "away" ? awayAbbr : "Draw";

  const predictedSide = pickFavored(prediction);
  const modelCorrect =
    winnerSide === "tie"
      ? predictedSide === "draw"
      : predictedSide === winnerSide;

  const top = topAvailableFactor(prediction.factors);
  const risk = biggestRiskFactor(prediction.factors);

  const userCorrect =
    userPick && winnerSide !== "tie" ? userPick.pickedTeam === winnerSide : null;

  return [
    {
      type: "result",
      title: "Final",
      body: `${winnerAbbr} ${Math.max(homeScore, awayScore)} — ${Math.min(homeScore, awayScore)} (model ${
        modelCorrect ? "✓" : "✗"
      })`,
      data: {
        homeScore,
        awayScore,
        winner: winnerSide,
        modelCorrect,
        userCorrect,
        userPick: userPick?.pickedTeam ?? null,
      },
    },
    {
      type: "factorPostmortem",
      title: "Factor Postmortem",
      body: top
        ? `${top.label} (weight ${(top.weight * 100).toFixed(0)}%) was the lead signal — ${
            modelCorrect ? "validated" : "overrated"
          }`
        : "Elo-only call",
      data: {
        topFactor: top
          ? { key: top.key, label: top.label, weight: top.weight, evidence: top.evidence }
          : null,
        modelCorrect,
      },
    },
    {
      type: "whatChanged",
      title: "What Changed",
      body: risk
        ? `Counter-signal: ${risk.label} — ${risk.evidence}`
        : `Final flowed with model: ${prediction.confidence.toFixed(1)}% on ${
            predictedSide === "home" ? homeAbbr : predictedSide === "away" ? awayAbbr : "Draw"
          }`,
      data: {
        counterFactor: risk
          ? { key: risk.key, label: risk.label, weight: risk.weight, evidence: risk.evidence }
          : null,
        confidence: prediction.confidence,
      },
    },
    {
      type: "nextOpportunity",
      title: "Next Opportunity",
      body: nextGame
        ? `${nextGame.awayTeam.abbreviation} @ ${nextGame.homeTeam.abbreviation} — ${nextGame.gameTime}`
        : "No upcoming matchup found in next 7 days",
      data: {
        nextGame: nextGame
          ? {
              id: nextGame.id,
              sport: nextGame.sport,
              gameTime: nextGame.gameTime,
              homeAbbr: nextGame.homeTeam.abbreviation,
              awayAbbr: nextGame.awayTeam.abbreviation,
            }
          : null,
      },
    },
  ];
}

// ─── Public entry point ──────────────────────────────────────────────────

/**
 * Assemble exactly four boxes for the given game state.
 *
 * Pure function — never throws, never fetches, never logs. All upstream I/O
 * (ESPN, market, prediction) must be resolved by the caller.
 */
export function assembleBoxes(input: AssembleInput): Box[] {
  const state = input.game.state;
  if (state === "pre") return preBoxes(input);
  if (state === "live") return liveBoxes(input);
  return finalBoxes(input);
}
