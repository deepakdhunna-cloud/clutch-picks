/**
 * State-store contract tests.
 *
 * The supersede-on-write decision is the only interesting logic in
 * stateStore.ts — everything else is a Prisma call. We unit-test
 * `decideSupersede` directly; the DB-bound `upsertPlayerAvailability`
 * is exercised in the orchestrator integration path.
 */

import { describe, it, expect } from "bun:test";
import { decideSupersede } from "../stateStore";

const T0 = new Date("2026-04-16T10:00:00Z");
const LATER = new Date("2026-04-16T10:30:00Z");

describe("decideSupersede", () => {
  it("higher-credibility incoming always wins over lower-credibility incumbent", () => {
    const result = decideSupersede(
      { credibility: 0.95, now: T0 },   // Shams (tier1)
      { credibility: 0.40, createdAt: LATER }, // Reddit (tier3), ironically newer
    );
    expect(result).toBe(true);
  });

  it("lower-credibility incoming never beats higher-credibility incumbent — even when newer", () => {
    const result = decideSupersede(
      { credibility: 0.40, now: LATER },
      { credibility: 0.95, createdAt: T0 },
    );
    expect(result).toBe(false);
  });

  it("same-credibility incoming wins only when strictly newer", () => {
    // Same tier2 beat writer, incoming older → keep incumbent
    expect(
      decideSupersede(
        { credibility: 0.75, now: T0 },
        { credibility: 0.75, createdAt: LATER },
      ),
    ).toBe(false);

    // Same tier2 beat writer, incoming newer → supersede
    expect(
      decideSupersede(
        { credibility: 0.75, now: LATER },
        { credibility: 0.75, createdAt: T0 },
      ),
    ).toBe(true);
  });

  it("same credibility + same timestamp → keep incumbent (no churn)", () => {
    expect(
      decideSupersede(
        { credibility: 0.75, now: T0 },
        { credibility: 0.75, createdAt: T0 },
      ),
    ).toBe(false);
  });
});
