import { describe, expect, it } from "bun:test";
import { buildDriftApiResponse } from "../accuracy";
import { formatCalibrationLeagueForResponse } from "../calibration";

const emptyCurve = [
  {
    bucket: "50-55",
    midpoint: 0.525,
    predictedWinRate: 0.525,
    actualWinRate: 0,
    count: 0,
  },
];

describe("model performance route helpers", () => {
  it("keeps drift responses inside the API data envelope even with too little data", () => {
    const now = new Date("2026-05-28T12:00:00.000Z").getTime();
    const response = buildDriftApiResponse(
      [{ wasCorrect: true, createdAt: new Date("2026-05-27T12:00:00.000Z") }],
      now,
    );

    expect(response).toEqual({
      data: {
        isDrifting: false,
        rollingAccuracy7d: null,
        rollingAccuracy30d: null,
        allTimeAccuracy: null,
        sample: { total: 1, last7d: 1, last30d: 1 },
        message: "Need 20+ resolved predictions",
      },
    });
  });

  it("returns null calibration metrics when a league has no resolved predictions", () => {
    const response = formatCalibrationLeagueForResponse(
      {
        league: "NCAAF",
        brierScore: 0.25,
        logLoss: Math.log(2),
        sampleSize: 0,
        reliabilityCurve: emptyCurve,
        note: "sampleSize < 100 is not statistically meaningful; displayed for transparency only.",
      },
      null,
    );

    expect(response.brierScore).toBeNull();
    expect(response.logLoss).toBeNull();
    expect(response.overallAccuracy).toBeNull();
    expect(response.note).toBe("No resolved predictions yet.");
    expect(response.reliabilityCurve[0]?.calibrationErrorPts).toBeNull();
  });
});
