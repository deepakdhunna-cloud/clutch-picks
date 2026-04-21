/**
 * EPL team-name normalization test for FBRef.
 *
 * Verifies that every current EPL team's ESPN displayName canonicalizes
 * to a key that FBRef actually uses. Catches alias map gaps and
 * normalization regressions without hitting the live FBRef site.
 */

import { describe, it, expect } from "bun:test";
import { canonicalName } from "../fbrefApi";

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
 * The normalized keys that FBRef uses for these teams.
 * Sourced from FBRef's EPL page — these are the keys our
 * `normalizeSoccerTeamName` produces when given FBRef's raw names.
 *
 * ESPN name → expected FBRef-side key after canonicalization.
 */
const EXPECTED_CANONICAL_KEYS: Record<string, string> = {
  "Chelsea": "chelsea",
  "Brighton & Hove Albion": "brighton",
  "Manchester United": "manchester utd",
  "Manchester City": "manchester city",
  "Newcastle United": "newcastle utd",
  "Nottingham Forest": "nottham forest",
  "Tottenham Hotspur": "tottenham",
  "Wolverhampton Wanderers": "wolves",
  "West Ham United": "west ham",
  "AFC Bournemouth": "bournemouth",
  "Liverpool": "liverpool",
  "Arsenal": "arsenal",
  "Aston Villa": "aston villa",
  "Everton": "everton",
  "Crystal Palace": "crystal palace",
  "Fulham": "fulham",
  "Brentford": "brentford",
  "Leicester City": "leicester city",
  "Ipswich Town": "ipswich town",
  "Southampton": "southampton",
};

describe("EPL team-name canonicalization (FBRef)", () => {
  it("every ESPN EPL team name canonicalizes to a known FBRef key", () => {
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
