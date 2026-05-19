import { describe, expect, test } from "bun:test";
import {
  extractTennisAthleteId,
  parseTennisRecentResultsFromHtml,
} from "../tennisStats";

describe("tennis stats enrichment helpers", () => {
  test("extracts athlete ids from ESPN ids, uids, and ranking refs", () => {
    expect(extractTennisAthleteId("3700")).toBe("3700");
    expect(extractTennisAthleteId("s:850~l:851~a:3700")).toBe("3700");
    expect(extractTennisAthleteId("http://sports.core.api.espn.com/v2/sports/tennis/athletes/2651?lang=en&region=us")).toBe("2651");
    expect(extractTennisAthleteId("Player To Be Decided")).toBeNull();
  });

  test("parses recent singles results without mixing in doubles rows", () => {
    const html = `
      <tr class="total"><td colspan="4">Men's Singles</td></tr>
      <tr><td>1st</td><td>Opponent A</td><td><span class="greenfont">W</span></td></tr>
      <tr><td>2nd</td><td>Opponent B</td><td><span class="redfont">L</span></td></tr>
      <tr class="total"><td colspan="4">Men's Doubles - Partner: Someone</td></tr>
      <tr><td>1st</td><td>Team C</td><td><span class="redfont">L</span></td></tr>
      <tr class="total"><td colspan="4">Men's Singles</td></tr>
      <tr><td>1st</td><td>Opponent D</td><td><span class="greenfont">W</span></td></tr>
    `;

    expect(parseTennisRecentResultsFromHtml(html, 10)).toEqual(["W", "L", "W"]);
  });
});
