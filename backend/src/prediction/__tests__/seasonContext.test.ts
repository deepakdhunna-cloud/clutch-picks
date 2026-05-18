import { describe, expect, it } from "bun:test";
import { deriveSeasonContext } from "../seasonContext";

describe("deriveSeasonContext", () => {
  it("uses explicit ESPN postseason metadata when present", () => {
    const ctx = deriveSeasonContext({
      sport: "NBA",
      gameTime: "2026-01-10T00:00:00Z",
      seasonSlug: "post-season",
      eventName: "Celtics vs Knicks",
    });

    expect(ctx?.phase).toBe("playoffs");
    expect(ctx?.source).toBe("espn");
    expect(ctx?.label.toLowerCase()).toContain("playoff");
  });

  it("derives NBA playoff context from the calendar when ESPN metadata is missing", () => {
    const ctx = deriveSeasonContext({
      sport: "NBA",
      gameTime: "2026-05-11T00:00:00Z",
    });

    expect(ctx?.phase).toBe("playoffs");
    expect(ctx?.source).toBe("date");
    expect(ctx?.detail.toLowerCase()).toContain("playoff");
  });

  it("derives UCL knockout context from the calendar", () => {
    const ctx = deriveSeasonContext({
      sport: "UCL",
      gameTime: "2026-04-14T19:00:00Z",
    });

    expect(ctx?.phase).toBe("tournament");
    expect(ctx?.label).toContain("UCL");
  });

  it("detects UCL group or league phase from explicit metadata", () => {
    const ctx = deriveSeasonContext({
      sport: "UCL",
      gameTime: "2026-10-14T19:00:00Z",
      seasonName: "League Phase",
    });

    expect(ctx?.phase).toBe("group_stage");
    expect(ctx?.label.toLowerCase()).toContain("group");
  });

  it("detects Super Bowl and World Series as title-stage contexts", () => {
    const nfl = deriveSeasonContext({
      sport: "NFL",
      gameTime: "2026-02-08T23:30:00Z",
      eventName: "Super Bowl LX",
    });
    const mlb = deriveSeasonContext({
      sport: "MLB",
      gameTime: "2026-10-28T00:00:00Z",
      eventName: "World Series Game 4",
    });

    expect(nfl?.phase).toBe("finals");
    expect(nfl?.label).toContain("Super Bowl");
    expect(mlb?.phase).toBe("finals");
    expect(mlb?.label).toContain("World Series");
  });

  it("detects Stanley Cup Final, MLS Cup, and bowl metadata without guessing names", () => {
    const nhl = deriveSeasonContext({
      sport: "NHL",
      gameTime: "2026-06-10T00:00:00Z",
      eventName: "Stanley Cup Final Game 3",
    });
    const mls = deriveSeasonContext({
      sport: "MLS",
      gameTime: "2026-12-05T00:00:00Z",
      eventName: "MLS Cup",
    });
    const ncaaf = deriveSeasonContext({
      sport: "NCAAF",
      gameTime: "2026-12-30T00:00:00Z",
      competitionNotes: ["Bowl Game"],
    });

    expect(nhl?.phase).toBe("finals");
    expect(mls?.phase).toBe("finals");
    expect(ncaaf?.phase).toBe("bowl");
  });

  it("detects college basketball tournament title-stage metadata", () => {
    const finalFour = deriveSeasonContext({
      sport: "NCAAB",
      gameTime: "2026-04-04T00:00:00Z",
      eventName: "Final Four",
    });
    const title = deriveSeasonContext({
      sport: "NCAAB",
      gameTime: "2026-04-06T00:00:00Z",
      eventName: "National Championship",
    });

    expect(finalFour?.phase).toBe("tournament");
    expect(title?.phase).toBe("finals");
  });

  it("returns null for an ordinary NBA regular-season date", () => {
    const ctx = deriveSeasonContext({
      sport: "NBA",
      gameTime: "2026-01-11T00:00:00Z",
    });

    expect(ctx).toBeNull();
  });
});
