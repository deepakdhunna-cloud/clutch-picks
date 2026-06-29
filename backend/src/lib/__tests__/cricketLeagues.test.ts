import { describe, it, expect } from "bun:test";
import {
  isReserveOrDevelopmentCompetition,
  isReserveTeamName,
  isT20Competition,
  isWomensCompetition,
} from "../cricketLeagues";

describe("cricketLeagues reserve/development filtering", () => {
  it("flags Second XI / 2nd XI competitions", () => {
    expect(isReserveOrDevelopmentCompetition("Second XI Trophy")).toBe(true);
    expect(isReserveOrDevelopmentCompetition("2nd XI T20 Competition")).toBe(true);
    expect(isReserveOrDevelopmentCompetition("County Development League")).toBe(true);
    expect(isReserveOrDevelopmentCompetition("Academy T20")).toBe(true);
    expect(isReserveOrDevelopmentCompetition("Under-19 World Cup")).toBe(true);
  });

  it("does not flag senior T20 competitions", () => {
    expect(isReserveOrDevelopmentCompetition("Indian Premier League")).toBe(false);
    expect(isReserveOrDevelopmentCompetition("Vitality Blast")).toBe(false);
    expect(isReserveOrDevelopmentCompetition("Big Bash League")).toBe(false);
    expect(isReserveOrDevelopmentCompetition("")).toBe(false);
  });

  it("flags reserve team names", () => {
    expect(isReserveTeamName("Hampshire 2nd XI")).toBe(true);
    expect(isReserveTeamName("Surrey Second XI")).toBe(true);
    expect(isReserveTeamName("Somerset 2nd XII")).toBe(true);
    expect(isReserveTeamName("India A")).toBe(true);
    expect(isReserveTeamName("England U19")).toBe(true);
  });

  it("does not flag senior team names", () => {
    expect(isReserveTeamName("Mumbai Indians")).toBe(false);
    expect(isReserveTeamName("Chennai Super Kings")).toBe(false);
    expect(isReserveTeamName("Hampshire")).toBe(false);
    expect(isReserveTeamName("")).toBe(false);
  });

  it("keeps existing T20 and women's detection intact", () => {
    expect(isT20Competition("Indian Premier League", "IPL")).toBe(true);
    expect(isT20Competition("Test Championship")).toBe(false);
    expect(isWomensCompetition("Women's Big Bash League")).toBe(true);
    expect(isWomensCompetition("Big Bash League")).toBe(false);
  });
});
