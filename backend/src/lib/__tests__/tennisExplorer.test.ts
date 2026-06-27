import { describe, expect, test } from "bun:test";
import {
  isFreshTennisExplorerLiveMatch,
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
    expect(rows[0]?.status).toBe("LIVE");
    expect(rows[0]?.homeSeed).toBe(7);
    expect(rows[0]?.homeLinescores).toEqual([5]);
    expect(rows[0]?.awayLinescores).toEqual([5]);
  });

  test("does not fuse tiebreak superscripts into the set games score", () => {
    // A set won 7-6 with a tiebreak renders the games count (7) followed by a
    // <sup> tiebreak count. The old parser stripped tags and concatenated the
    // digits, producing a bogus value like 74 / 61. The fixed parser must keep
    // only the games count and clamp to the valid 0..7 range.
    const html = `
      <tr class="head flags">
        <td class="t-name" colspan="2"><a href="/atp/2026/atp-men/">ATP Event</a></td>
      </tr>
      <tr id="r1" class="one bott">
        <td class="first time" rowspan="2">06:30</td>
        <td class="t-name"><a href="/player/a/">Martinez B.</a></td>
        <td class="result">1</td>
        <td class="score">7<sup>4</sup></td>
        <td class="score">6<sup>1</sup></td>
        <td rowspan="2"><a href="/match-detail/?id=9001">info</a></td>
      </tr>
      <tr id="r1b" class="one">
        <td class="t-name"><a href="/player/b/">Salazar D.</a></td>
        <td class="result">0</td>
        <td class="score">6<sup>2</sup></td>
        <td class="score">3</td>
      </tr>
    `;

    const rows = parseTennisExplorerMatchRows(html, "ATP", "2026-05-18");

    expect(rows).toHaveLength(1);
    // Games counts only — no fused tiebreak digits, all within 0..7.
    expect(rows[0]?.homeLinescores).toEqual([7, 6]);
    expect(rows[0]?.awayLinescores).toEqual([6, 3]);
  });

  test("finds near-term scheduled rows before scores exist", () => {
    const rows = parseTennisExplorerMatchRows(`
      <tr class="head flags">
        <td class="t-name" colspan="2"><a href="/french-open/2026/atp-men/">French Open</a></td>
      </tr>
      <tr id="r10" class="one bott">
        <td class="first time" rowspan="2">11:00</td>
        <td class="t-name"><a href="/player/kecmanovic/">Kecmanovic M.</a></td>
        <td class="nbr">&nbsp;</td>
        <td class="score nbr">&nbsp;</td>
        <td rowspan="2"><a href="/match-detail/?id=3211687">info</a></td>
      </tr>
      <tr id="r10b" class="one">
        <td class="t-name"><a href="/player/marozsan/">Marozsan F.</a></td>
        <td class="nbr">&nbsp;</td>
        <td class="score nbr">&nbsp;</td>
      </tr>
    `, "ATP", "2026-05-24");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("SCHEDULED");
    expect(rows[0]?.homeSets).toBeUndefined();
    expect(rows[0]?.homeLinescores).toEqual([]);
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

  test("only treats recent scored rows as trusted supplemental live matches", () => {
    const [candidate] = parseTennisExplorerMatchRows(`
      <tr class="head flags">
        <td class="t-name" colspan="2"><a href="/challenger/2026/atp-men/">Challenger</a></td>
      </tr>
      <tr id="r122" class="one bott">
        <td class="first time" rowspan="2">14:00</td>
        <td class="t-name"><a href="/player/first/">First P.</a></td>
        <td class="result">1</td><td class="score">2</td>
        <td rowspan="2"><a href="/match-detail/?id=3204337">info</a></td>
      </tr>
      <tr id="r122b" class="one">
        <td class="t-name"><a href="/player/second/">Second P.</a></td>
        <td class="result">0</td><td class="score">3</td>
      </tr>
    `, "ATP", "2026-05-23");

    const match = parseTennisExplorerMatchDetail(`
      <th class="plName" colspan="2"><a href="/player/first">First Player</a></th>
      <td class="gScore"><span>(2-3)</span></td>
      <th class="plName" colspan="2"><a href="/player/second">Second Player</a></th>
    `, candidate!);

    expect(isFreshTennisExplorerLiveMatch(match, new Date("2026-05-23T16:00:00.000Z"))).toBe(true);
    expect(isFreshTennisExplorerLiveMatch(match, new Date("2026-05-24T00:30:00.000Z"))).toBe(false);
  });

  test("keeps scheduled supplemental rows only near their start time", () => {
    const [candidate] = parseTennisExplorerMatchRows(`
      <tr class="head flags">
        <td class="t-name" colspan="2"><a href="/french-open/2026/atp-men/">French Open</a></td>
      </tr>
      <tr id="r10" class="one bott">
        <td class="first time" rowspan="2">11:00</td>
        <td class="t-name"><a href="/player/kecmanovic/">Kecmanovic M.</a></td>
        <td class="nbr">&nbsp;</td><td class="score nbr">&nbsp;</td>
        <td rowspan="2"><a href="/match-detail/?id=3211687">info</a></td>
      </tr>
      <tr id="r10b" class="one">
        <td class="t-name"><a href="/player/marozsan/">Marozsan F.</a></td>
        <td class="nbr">&nbsp;</td><td class="score nbr">&nbsp;</td>
      </tr>
    `, "ATP", "2026-05-24");

    const match = parseTennisExplorerMatchDetail("", candidate!);

    expect(isFreshTennisExplorerLiveMatch(match, new Date("2026-05-23T12:00:00.000Z"))).toBe(true);
    expect(isFreshTennisExplorerLiveMatch(match, new Date("2026-05-24T13:00:00.000Z"))).toBe(false);
  });
});
