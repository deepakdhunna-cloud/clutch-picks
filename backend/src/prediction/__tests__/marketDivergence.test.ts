/**
 * Market-divergence annotation tests — Prompt B Gap 2d.
 *
 * Exercises predictGame's post-hoc market comparison block. The divergence
 * check is cosmetic (annotation only) — model math is unchanged regardless.
 */

import { describe, it, expect } from "bun:test";
import { predictGame } from "../index";
import type { MarketConsensus, MarketLine } from "../../lib/sharpApi";
import { makeSoccerContext } from "./_soccerFixtures";

function makeMarket(homeNoVig: number): MarketConsensus {
  const pinnacle: MarketLine = {
    sportsbook: "Pinnacle",
    homeAmerican: -150, awayAmerican: 130,
    homeDecimal: 1.67, awayDecimal: 2.30,
    homeImpliedProb: homeNoVig,
    awayImpliedProb: 1 - homeNoVig,
    fetchedAt: new Date().toISOString(),
  };
  return {
    lines: [pinnacle],
    pinnacleLine: pinnacle,
    noVigHomeProb: homeNoVig,
    noVigAwayProb: 1 - homeNoVig,
    avgHomeProb: homeNoVig,
    avgAwayProb: 1 - homeNoVig,
  };
}

describe("marketComparison annotation", () => {
  it("does NOT flag divergence when model and market agree within 10 pts", () => {
    // The EPL fixture produces ~40% home-win (home Elo==away Elo + HFA, with
    // soccer draw adjustment). Pick a market value within 10pts of that.
    const ctx = makeSoccerContext("EPL", {
      marketConsensus: makeMarket(0.45),
    });
    const prediction = predictGame(ctx);
    expect(prediction.marketComparison).toBeDefined();
    expect(prediction.marketComparison!.isDivergent).toBe(false);
    expect(prediction.marketComparison!.divergence).toBeLessThanOrEqual(0.10);
  });

  it("FLAGS divergence when model and market differ by >10 pts", () => {
    // Model sits near 40% home; market says 70% home → gap >10pts.
    const ctx = makeSoccerContext("EPL", {
      marketConsensus: makeMarket(0.70),
    });
    const prediction = predictGame(ctx);
    expect(prediction.marketComparison).toBeDefined();
    expect(prediction.marketComparison!.isDivergent).toBe(true);
    expect(prediction.marketComparison!.divergence).toBeGreaterThan(0.10);
    // Sanity: the divergence annotation should NOT change the model's own
    // home-win probability (market is an anchor, not an input).
    expect(prediction.marketComparison!.modelHomeProb).toBe(
      prediction.homeWinProbability,
    );
  });

  it("omits marketComparison when no market consensus is available", () => {
    const ctx = makeSoccerContext("EPL"); // no marketConsensus
    const prediction = predictGame(ctx);
    expect(prediction.marketComparison).toBeUndefined();
  });
});
