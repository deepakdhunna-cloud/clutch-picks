/**
 * EPL team-name normalization test.
 *
 * Verifies that every current EPL team's ESPN displayName canonicalizes
 * to a key that Understat actually uses. Catches alias map gaps and
 * normalization regressions without hitting the live Understat API.
 */

import { describe, it, expect } from "bun:test";
import { canonicalName } from "../understatApi";

/**
 * The 20 EPL teams for the 2024-25 season, as ESPN's scoreboard API
 * returns them in the `displayName` field.
 */
const ESPN_EPL_TEAM_NAMES = [
  "Chelsea",
  "Brighton & Hove Albion",
  "Manchester United",
  "Manchester City",
  "Newcastle United",
  "Nottingham Forest",
  "Tottenham Hotspur",
  "Wolverhampton Wanderers",
  "West Ham United",
  "AFC Bournemouth",
  "Liverpool",
  "Arsenal",
  "Aston Villa",
  "Everton",
  "Crystal Palace",
  "Fulham",
  "Brentford",
  "Leicester City",
  "Ipswich Town",
  "Southampton",
] as const;

/**
 * The normalized keys that Understat uses for these teams.
 * Sourced from Understat's EPL page — these are the keys our
 * `normalizeSoccerTeamName` produces when given Understat's raw names.
 *
 * ESPN name → expected Understat-side key after canonicalization.
 */
const EXPECTED_CANONICAL_KEYS: Record<string, string> = {
  "Chelsea": "chelsea",
  "Brighton & Hove Albion": "brighton",
  "Manchester United": "manchester united",
  "Manchester City": "manchester city",
  "Newcastle United": "newcastle united",
  "Nottingham Forest": "nottingham forest",
  "Tottenham Hotspur": "tottenham",
  "Wolverhampton Wanderers": "wolverhampton wanderers",
  "West Ham United": "west ham",
  "AFC Bournemouth": "bournemouth",
  "Liverpool": "liverpool",
  "Arsenal": "arsenal",
  "Aston Villa": "aston villa",
  "Everton": "everton",
  "Crystal Palace": "crystal palace",
  "Fulham": "fulham",
  "Brentford": "brentford",
  "Leicester City": "leicester",
  "Ipswich Town": "ipswich",
  "Southampton": "southampton",
};

describe("EPL team-name canonicalization", () => {
  it("every ESPN EPL team name canonicalizes to a known Understat key", () => {
    const failures: string[] = [];

    for (const espnName of ESPN_EPL_TEAM_NAMES) {
      const canonical = canonicalName(espnName);
      const expected = EXPECTED_CANONICAL_KEYS[espnName];

      if (!expected) {
        failures.push(`${espnName}: no expected key defined in test`);
        continue;
      }

      if (canonical !== expected) {
        failures.push(
          `${espnName}: canonicalized to "${canonical}" but expected "${expected}"`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `EPL team-name canonicalization failures (${failures.length}/${ESPN_EPL_TEAM_NAMES.length}):\n` +
        failures.map((f) => `  - ${f}`).join("\n"),
      );
    }
  });

  it("all 20 EPL teams are covered", () => {
    expect(ESPN_EPL_TEAM_NAMES.length).toBe(20);
    expect(Object.keys(EXPECTED_CANONICAL_KEYS).length).toBe(20);
  });
});
