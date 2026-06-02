import { describe, expect, it } from "bun:test";
import { parseMatchResult } from "../tennisElo";

describe("parseMatchResult (tennis player-Elo source)", () => {
  it("extracts winner/loser player ids from a completed ESPN tennis match", () => {
    const match = {
      competitors: [
        { id: "111", winner: true },
        { id: "222", winner: false },
      ],
    };
    const r = parseMatchResult(match, "20260510");
    expect(r).not.toBeNull();
    expect(r!.teamId).toBe("111"); // winner
    expect(r!.opponentId).toBe("222"); // loser
    expect(r!.won).toBe(true);
    expect(r!.date).toBe("20260510");
  });

  it("reads the athlete id when the competitor id is nested", () => {
    const match = {
      competitors: [
        { athlete: { id: "900" }, winner: false },
        { athlete: { id: "901" }, winner: true },
      ],
    };
    const r = parseMatchResult(match, "20260511");
    expect(r!.teamId).toBe("901");
    expect(r!.opponentId).toBe("900");
  });

  it("returns null for an in-progress match with no winner flag", () => {
    const match = { competitors: [{ id: "1" }, { id: "2" }] };
    expect(parseMatchResult(match, "20260510")).toBeNull();
  });

  it("returns null for malformed / single-competitor data", () => {
    expect(parseMatchResult({ competitors: [{ id: "1", winner: true }] }, "20260510")).toBeNull();
    expect(parseMatchResult({}, "20260510")).toBeNull();
    expect(parseMatchResult({ competitors: [{ id: "1", winner: true }, { id: "1", winner: false }] }, "20260510")).toBeNull();
  });

  it("returns null when date is missing (undated results can't be rolled)", () => {
    const match = { competitors: [{ id: "1", winner: true }, { id: "2", winner: false }] };
    expect(parseMatchResult(match, "")).toBeNull();
  });
});
