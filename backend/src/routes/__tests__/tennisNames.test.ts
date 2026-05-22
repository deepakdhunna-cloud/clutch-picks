import { describe, expect, test } from "bun:test";
import {
  isTennisPlaceholderName,
  tennisAbbreviation,
  tennisCompetitorName,
  tennisDisplayColor,
} from "../games";

describe("tennis display names", () => {
  test("keeps real player names instead of replacing them", () => {
    const name = tennisCompetitorName({ nm: "Jannik Sinner", rnk: 1 } as any, false);

    expect(name).toBe("Jannik Sinner");
    expect(tennisAbbreviation(name)).toBe("SINN");
  });

  test("uses roster names when ESPN competitor name is a placeholder", () => {
    const name = tennisCompetitorName({
      nm: "TBD",
      rstr: [{ nm: "Coco Gauff" }],
    } as any, false);

    expect(name).toBe("Coco Gauff");
    expect(tennisAbbreviation(name)).toBe("GAUF");
  });

  test("normalizes raw TBD and numeric slots before they reach app cards", () => {
    expect(isTennisPlaceholderName("TBD")).toBe(true);
    expect(isTennisPlaceholderName("TBD / TBD")).toBe(true);
    expect(isTennisPlaceholderName("-3")).toBe(true);
    expect(isTennisPlaceholderName("s:850~l:851~a:-3")).toBe(true);

    const singlesName = tennisCompetitorName({ nm: "-3" } as any, false);
    const doublesName = tennisCompetitorName({ nm: "TBD", rstr: [{ nm: "TBD" }] } as any, true);

    expect(singlesName).toBe("Player To Be Decided");
    expect(doublesName).toBe("Doubles Team To Be Decided");
    expect(tennisAbbreviation(singlesName)).toBe("TBA");
    expect(tennisAbbreviation(doublesName, [{ nm: "TBD" }])).toBe("TBA");
  });

  test("does not fall back every unmapped tennis player to green", () => {
    const chungColor = tennisDisplayColor("Yunseong Chung", { country: "KOR", tour: "ATP" });
    const shinColor = tennisDisplayColor("Sanhui Shin", { country: "KOR", tour: "ATP", side: "away", offset: 5 });
    const unmappedColor = tennisDisplayColor("Lower tour player without country", { tour: "WTA" });

    expect(chungColor).toBe("#1F4E9E");
    expect(shinColor).not.toBe("#2E7D5B");
    expect(unmappedColor).not.toBe("#2E7D5B");
  });
});
