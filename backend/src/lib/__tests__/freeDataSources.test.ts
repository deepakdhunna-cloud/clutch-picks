import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  fetchFreeAdvancedMetrics,
  fetchFreeIPLVenueSplit,
  fetchFreeTennisProfileByName,
  resetFreeDataSourceCachesForTest,
} from "../freeDataSources";

let fetchSpy: any;

function mockFetch(routes: Record<string, unknown | string>): void {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      const match = Object.entries(routes).find(([path]) => url.includes(path));
      if (!match) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      const body = match[1];
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status: 200,
        headers: {
          "Content-Type": typeof body === "string" ? "text/csv" : "application/json",
        },
      });
    }) as typeof fetch,
  );
}

beforeEach(() => {
  resetFreeDataSourceCachesForTest();
});

afterEach(() => {
  fetchSpy?.mockRestore?.();
  fetchSpy = undefined;
  resetFreeDataSourceCachesForTest();
});

describe("free public data source enrichment", () => {
  it("derives basketball rating inputs from ESPN game summary team averages", async () => {
    mockFetch({
      "basketball/nba/summary?event=401": {
        boxscore: {
          teams: [
            {
              team: { id: "5", displayName: "Cleveland Cavaliers", abbreviation: "CLE" },
              statistics: [
                { name: "avgPoints", displayValue: "118.4" },
                { name: "avgPointsAgainst", displayValue: "110.2" },
                { name: "fieldGoalPct", displayValue: "48.1" },
              ],
            },
          ],
        },
      },
    });

    const metrics = await fetchFreeAdvancedMetrics({
      sport: "NBA",
      gameId: "401",
      teamId: "5",
      teamName: "Cleveland Cavaliers",
      teamAbbreviation: "CLE",
      gameDate: new Date("2026-05-25T00:00:00Z"),
    });

    expect(metrics?.offensiveRating).toBeCloseTo(118.4, 5);
    expect(metrics?.defensiveRating).toBeCloseTo(110.2, 5);
    expect(metrics?.effectiveFGPct).toBeCloseTo(0.481, 5);
  });

  it("loads NHL special teams and save percentage from the public NHL stats endpoint", async () => {
    mockFetch({
      "api.nhle.com/stats/rest/en/team/summary": {
        data: [
          {
            teamFullName: "Colorado Avalanche",
            powerPlayPct: 0.175675,
            penaltyKillPct: 0.838236,
            shotsAgainstPerGame: 26.10638,
            goalsAgainstPerGame: 2.46808,
            shotsForPerGame: 33.64893,
          },
        ],
      },
    });

    const metrics = await fetchFreeAdvancedMetrics({
      sport: "NHL",
      gameId: "401872906",
      teamId: "17",
      teamName: "Colorado Avalanche",
      teamAbbreviation: "COL",
      gameDate: new Date("2026-05-25T00:00:00Z"),
    });

    expect(metrics?.powerPlayPct).toBeCloseTo(0.175675, 5);
    expect(metrics?.penaltyKillPct).toBeCloseTo(0.838236, 5);
    expect(metrics?.shotsPerGame).toBeCloseTo(33.64893, 5);
    expect(metrics?.savePercentage).toBeCloseTo(1 - 2.46808 / 26.10638, 5);
  });

  it("derives tennis rank and recent form by player name from public match files", async () => {
    mockFetch({
      "atp_matches_2026.csv": [
        "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points",
        "20260110,1,Taylor Fritz,Stan Wawrinka,9,3840,156,397",
        "20260112,2,Hubert Hurkacz,Taylor Fritz,83,710,9,3840",
        "20260115,3,Taylor Fritz,Player C,9,3840,50,1000",
      ].join("\n"),
      "atp_matches_2025.csv": "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points\n",
    });

    const profile = await fetchFreeTennisProfileByName("Taylor Fritz", "ATP", 10);

    expect(profile?.tour).toBe("ATP");
    expect(profile?.rank).toBe(9);
    expect(profile?.rankingPoints).toBe(3840);
    expect(profile?.form?.results).toEqual(["W", "L", "W"]);
    expect(profile?.form?.wins).toBe(2);
    expect(profile?.form?.losses).toBe(1);
  });

  it("normalizes ESPN tennis names with parenthetical birth years before public match lookup", async () => {
    mockFetch({
      "atp_matches_2026.csv": [
        "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points",
        "20260520,1,Cezar Cretu,Player A,291,180,500,20",
        "20260522,2,Player B,Cezar Cretu,350,90,291,180",
      ].join("\n"),
      "atp_matches_2025.csv": "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points\n",
    });

    const profile = await fetchFreeTennisProfileByName("Cezar (2001) Cretu", "ATP", 10);

    expect(profile?.rank).toBe(291);
    expect(profile?.form?.results).toEqual(["W", "L"]);
  });

  it("uses TennisExplorer profile rows when GitHub match files do not contain a player", async () => {
    mockFetch({
      "atp_matches_2026.csv": "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points\n",
      "atp_matches_2025.csv": "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points\n",
      "atp_rankings_current.csv": "rank,player,points\n",
      "atp_players.csv": "player_id,name_first,name_last\n",
      "matches/?type=atp-single": `
        <td class="t-name"><a href="/player/watanuki-223ad/">Watanuki Y.</a></td>
      `,
      "player/watanuki-223ad": `
        <title>Yosuke Watanuki - Tennis Explorer</title>
        <h3>Watanuki Yosuke</h3>
        <div class="date">Current/Highest rank - singles: 271. / 72.</div>
        <div class="date">Sex: man</div>
        <tr class="one">
          <td class="t-name"><a href="/player/cina/">Cina F.</a> - <a href="/player/watanuki-223ad/"><strong>Watanuki Y.</strong></a></td>
          <td class="tl"><a>6-4, 6-4</a></td>
        </tr>
        <tr class="two">
          <td class="t-name"><a href="/player/watanuki-223ad/"><strong>Watanuki Y.</strong></a> - <a href="/player/broska/">Broska F.</a></td>
          <td class="tl"><a>6-1, 6-4</a></td>
        </tr>
        <tr class="one">
          <td class="t-name"><a href="/player/watanuki-223ad/"><strong>Watanuki Y.</strong></a> - <a href="/player/ofner/">Ofner S.</a></td>
          <td class="tl"><a>6-3, 6-4</a></td>
        </tr>
      `,
    });

    const profile = await fetchFreeTennisProfileByName("Yosuke Watanuki", "ATP", 10, new Date("2026-05-27T00:00:00Z"));

    expect(profile?.tour).toBe("ATP");
    expect(profile?.rank).toBe(271);
    expect(profile?.form?.results).toEqual(["W", "W", "L"]);
    expect(profile?.form?.wins).toBe(2);
    expect(profile?.form?.losses).toBe(1);
  });

  it("resolves doubles-team TennisExplorer links to individual player profiles", async () => {
    mockFetch({
      "wta_matches_2026.csv": "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points\n",
      "wta_matches_2025.csv": "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points\n",
      "wta_rankings_current.csv": "rank,player,points\n",
      "wta_players.csv": "player_id,name_first,name_last\n",
      "matches/?type=wta-double": `
        <td class="t-name"><a href="/doubles-team/kasatkina/osorio-16592/" title="Kasatkina D. / Osorio C.">Kasatkina / Osorio C.</a></td>
      `,
      "player/kasatkina": `
        <title>Daria Kasatkina - Tennis Explorer</title>
        <h3>Kasatkina Daria</h3>
        <div class="date">Current/Highest rank - singles: 16. / 8.</div>
        <div class="date">Sex: woman</div>
        <tr class="one"><td class="t-name"><a><strong>Kasatkina D.</strong></a> - <a>Opponent A</a></td><td class="tl">6-4, 6-4</td></tr>
        <tr class="two"><td class="t-name"><a>Opponent B</a> - <a><strong>Kasatkina D.</strong></a></td><td class="tl">6-2, 6-2</td></tr>
      `,
      "player/osorio-16592": `
        <title>Camila Osorio - Tennis Explorer</title>
        <h3>Osorio Camila</h3>
        <div class="date">Current/Highest rank - singles: 61. / 33.</div>
        <div class="date">Sex: woman</div>
        <tr class="one"><td class="t-name"><a><strong>Osorio C.</strong></a> - <a>Opponent C</a></td><td class="tl">7-5, 6-3</td></tr>
        <tr class="two"><td class="t-name"><a>Opponent D</a> - <a><strong>Osorio C.</strong></a></td><td class="tl">6-1, 6-2</td></tr>
      `,
    });

    const profile = await fetchFreeTennisProfileByName("Daria Kasatkina / Camila Osorio", "WTA", 10, new Date("2026-05-26T00:00:00Z"));

    expect(profile?.tour).toBe("WTA");
    expect(profile?.rank).toBeCloseTo(38.5, 5);
    expect(profile?.form?.wins).toBe(2);
    expect(profile?.form?.losses).toBe(2);
  });

  it("derives IPL home and away split from ESPN cricket head-to-head events", async () => {
    mockFetch({
      "cricket/8048/summary?event=1535462": {
        headToHeadGames: [
          {
            team: { id: "HOME", abbreviation: "HOM" },
            events: [
              { id: "1", homeTeamId: "HOME", awayTeamId: "AWAY", gameResult: "W" },
              { id: "2", homeTeamId: "HOME", awayTeamId: "AWAY", gameResult: "L" },
              { id: "3", homeTeamId: "HOME", awayTeamId: "AWAY", gameResult: "W" },
              { id: "4", homeTeamId: "AWAY", awayTeamId: "HOME", gameResult: "L" },
            ],
          },
        ],
      },
    });

    const split = await fetchFreeIPLVenueSplit("1535462", "HOME", "AWAY");

    expect(split?.homeGames).toBe(3);
    expect(split?.awayGames).toBe(3);
    expect(split?.homeWinPct).toBeCloseTo(2 / 3, 5);
    expect(split?.awayRoadWinPct).toBeCloseTo(1 / 3, 5);
  });

  it("aggregates doubles player form instead of treating pair names as missing", async () => {
    mockFetch({
      "atp_matches_2026.csv": [
        "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points",
        "20260110,1,Marcel Granollers,Player A,12,3000,100,500",
        "20260111,2,Player B,Horacio Zeballos,90,600,15,2800",
        "20260112,3,Horacio Zeballos,Player C,15,2800,70,700",
      ].join("\n"),
      "atp_matches_2025.csv": "tourney_date,match_num,winner_name,loser_name,winner_rank,winner_rank_points,loser_rank,loser_rank_points\n",
    });

    const profile = await fetchFreeTennisProfileByName("Marcel Granollers / Horacio Zeballos", "ATP", 10);

    expect(profile?.rank).toBeCloseTo(13.5, 5);
    expect(profile?.form?.wins).toBe(2);
    expect(profile?.form?.losses).toBe(1);
  });
});
