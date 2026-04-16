/**
 * SharpAPI client tests — Prompt B Gap 2.
 *
 * We test the pure helpers directly (devigPinnacle, buildConsensus) and
 * the missing-key gate. We do NOT exercise the real HTTP path — that'd
 * require network flake tolerance; integration testing is done separately.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  devigPinnacle,
  buildConsensus,
  fetchMarketConsensus,
  type MarketLine,
} from "../../lib/sharpApi";

function makeLine(overrides: Partial<MarketLine> = {}): MarketLine {
  return {
    sportsbook: "Pinnacle",
    homeAmerican: -150,
    awayAmerican: 130,
    homeDecimal: 1.67,
    awayDecimal: 2.30,
    homeImpliedProb: 0.6,
    awayImpliedProb: 0.4348,   // slight overround (vig)
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("devigPinnacle", () => {
  it("removes vig proportionally so probabilities sum to 1", () => {
    // With drawImpliedProb present, total should still normalize.
    const line = makeLine({
      homeImpliedProb: 0.55,
      awayImpliedProb: 0.30,
      drawImpliedProb: 0.22,  // sum = 1.07 = 7% vig
    });
    const r = devigPinnacle(line);
    const sum = r.noVigHomeProb + r.noVigAwayProb + (r.noVigDrawProb ?? 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(r.noVigHomeProb).toBeCloseTo(0.55 / 1.07, 6);
    expect(r.noVigAwayProb).toBeCloseTo(0.30 / 1.07, 6);
    expect(r.noVigDrawProb).toBeCloseTo(0.22 / 1.07, 6);
  });

  it("falls back to 50/50 on a zero-total line (defensive)", () => {
    const line = makeLine({ homeImpliedProb: 0, awayImpliedProb: 0 });
    const r = devigPinnacle(line);
    expect(r.noVigHomeProb).toBe(0.5);
    expect(r.noVigAwayProb).toBe(0.5);
  });

  it("buildConsensus uses Pinnacle for de-vig when present", () => {
    // Pinnacle sees a true 60/40; DraftKings is skewed.
    const lines: MarketLine[] = [
      makeLine({ sportsbook: "Pinnacle",  homeImpliedProb: 0.60, awayImpliedProb: 0.40 }),
      makeLine({ sportsbook: "DraftKings", homeImpliedProb: 0.66, awayImpliedProb: 0.38 }),
    ];
    const c = buildConsensus(lines);
    expect(c.pinnacleLine?.sportsbook).toBe("Pinnacle");
    // Pinnacle total = 1.0 exactly → de-vig no-op → 0.60
    expect(c.noVigHomeProb).toBeCloseTo(0.60, 6);
    expect(c.noVigAwayProb).toBeCloseTo(0.40, 6);
    // avgHome is the vig-inclusive mean (0.60+0.66)/2 = 0.63
    expect(c.avgHomeProb).toBeCloseTo(0.63, 6);
  });
});

describe("fetchMarketConsensus — missing-key gate", () => {
  const savedKey = process.env.SHARPAPI_KEY;
  beforeEach(() => { delete process.env.SHARPAPI_KEY; });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.SHARPAPI_KEY;
    else process.env.SHARPAPI_KEY = savedKey;
  });

  it("returns null (not throws) when SHARPAPI_KEY is unset", async () => {
    const result = await fetchMarketConsensus(
      "NBA", "Home", "Away", new Date(),
    );
    expect(result).toBeNull();
  });
});
