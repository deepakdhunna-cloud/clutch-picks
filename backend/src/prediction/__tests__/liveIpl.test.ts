import { describe, expect, it } from "bun:test";
import { computeLiveIplChaseRead } from "../liveIpl";

describe("live IPL chase read", () => {
  it("turns a steep second-innings chase into a defending-team live pick", () => {
    const read = computeLiveIplChaseRead({
      sport: "IPL",
      status: "LIVE",
      homeTeam: { abbreviation: "RCB" },
      awayTeam: { abbreviation: "GT" },
      cricketState: {
        home: { runs: 254, wickets: 5, overs: 20, maxOvers: 20, scoreText: "254/5" },
        away: { runs: 47, wickets: 2, overs: 4.3, maxOvers: 20, isBatting: true, scoreText: "47/2" },
        battingSide: "away",
        target: 255,
      },
    });

    expect(read).not.toBeNull();
    expect(read!.pick).toBe("home");
    expect(read!.homeWinProbability).toBeGreaterThan(0.65);
    expect(read!.requiredRunRate).toBeGreaterThan(13);
    expect(read!.ballsRemaining).toBe(93);
  });

  it("keeps a comfortable chase with wickets in hand on the batting side", () => {
    const read = computeLiveIplChaseRead({
      sport: "IPL",
      status: "LIVE",
      homeTeam: { abbreviation: "CSK" },
      awayTeam: { abbreviation: "MI" },
      cricketState: {
        home: { runs: 170, wickets: 6, overs: 20, maxOvers: 20, scoreText: "170/6" },
        away: { runs: 95, wickets: 2, overs: 9.0, maxOvers: 20, isBatting: true, scoreText: "95/2" },
        battingSide: "away",
        target: 171,
      },
    });

    expect(read).not.toBeNull();
    expect(read!.pick).toBe("away");
    expect(read!.awayWinProbability).toBeGreaterThan(0.75);
    expect(read!.runsNeeded).toBe(76);
  });
});
