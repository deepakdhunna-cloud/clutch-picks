import { describe, expect, test } from "bun:test";
import {
  parseTennisExplorerMatchDetail,
  parseTennisExplorerMatchRows,
} from "../tennisExplorer";

describe("Tennis Explorer supplemental live parser", () => {
  test("finds in-progress lower-tier tennis rows from the match list", () => {
    const html = `
      <tr class="head flags">
        <td class="t-name" colspan="2"><a href="/bangalore-3-challenger/2026/atp-men/">Bangalore 3 challenger</a></td>
      </tr>
      <tr id="r122" class="one bott">
        <td class="first time" rowspan="2">06:30</td>
        <td class="t-name"><a href="/player/singh-e3612/">Singh K.</a> (7)</td>
        <td class="result">0</td>
        <td class="score">5</td>
        <td class="h2h">1</td>
        <td rowspan="2"><a href="/match-detail/?id=3204336">info</a></td>
      </tr>
      <tr id="r122b" class="one">
        <td class="t-name"><a href="/player/leong-e28bd/">Leong M.</a></td>
        <td class="result">0</td>
        <td class="score">5</td>
        <td class="h2h">0</td>
      </tr>
    `;

    const rows = parseTennisExplorerMatchRows(html, "ATP", "2026-05-18");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("3204336");
    expect(rows[0]?.homeSeed).toBe(7);
    expect(rows[0]?.homeLinescores).toEqual([5]);
    expect(rows[0]?.awayLinescores).toEqual([5]);
  });

  test("marks interrupted detail pages as suspended with no announced time", () => {
    const [candidate] = parseTennisExplorerMatchRows(`
      <tr class="head flags">
        <td class="t-name" colspan="2"><a href="/bangalore-3-challenger/2026/atp-men/">Bangalore 3 challenger</a></td>
      </tr>
      <tr id="r122" class="one bott">
        <td class="first time" rowspan="2">06:30</td>
        <td class="t-name"><a href="/player/singh-e3612/">Singh K.</a> (7)</td>
        <td class="result">0</td><td class="score">5</td>
        <td rowspan="2"><a href="/match-detail/?id=3204336">info</a></td>
      </tr>
      <tr id="r122b" class="one">
        <td class="t-name"><a href="/player/leong-e28bd/">Leong M.</a></td>
        <td class="result">0</td><td class="score">5</td>
      </tr>
    `, "ATP", "2026-05-18");

    const match = parseTennisExplorerMatchDetail(`
      <th class="plName" colspan="2"><a href="/player/singh-e3612">Singh Karan</a></th>
      <td class="gScore"><span>(5-5)</span></td>
      <th class="plName" colspan="2"><a href="/player/leong-e28bd">Leong Mitsuki Wei Kang</a></th>
      <td class="gInterrupted" colspan="5">match interrupted</td>
      <td class="tr">415.</td><th>Singles ranking</th><td class="tl">571.</td>
    `, candidate!);

    expect(match.homeName).toBe("Karan Singh");
    expect(match.awayName).toBe("Mitsuki Wei Kang Leong");
    expect(match.homeRank).toBe(415);
    expect(match.awayRank).toBe(571);
    expect(match.suspended).toBe(true);
    expect(match.quarter).toBe("Suspended");
    expect(match.suspension?.resumeText).toBe("No time announced");
    expect(match.suspension?.reasonText).toBe("Reason not reported");
  });
});
