import { describe, expect, test } from "bun:test";
import { resolveMlbInningTransitionForStatus } from "../games";

describe("resolveMlbInningTransitionForStatus", () => {
  test("treats a top-half ending as the middle of the inning", () => {
    expect(
      resolveMlbInningTransitionForStatus({
        detailTexts: ["End Top 8th", "End 8th"],
      }),
    ).toBe("mid");
  });

  test("uses pitcher and batter team context when ESPN only says End", () => {
    expect(
      resolveMlbInningTransitionForStatus({
        detailTexts: ["End 8th"],
        homeTeamId: "19",
        awayTeamId: "26",
        pitcherTeamId: "19",
        batterTeamId: "26",
      }),
    ).toBe("mid");
  });

  test("keeps a completed bottom half as the end of the inning", () => {
    expect(
      resolveMlbInningTransitionForStatus({
        detailTexts: ["End 8th"],
        homeTeamId: "19",
        awayTeamId: "26",
        pitcherTeamId: "26",
        batterTeamId: "19",
      }),
    ).toBe("end");
  });
});
