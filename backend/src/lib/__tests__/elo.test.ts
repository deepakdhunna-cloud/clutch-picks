import { describe, expect, it, spyOn } from "bun:test";

describe("getEloRating", () => {
  it("falls back to the default rating when the Elo table cannot be read", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/clutch_picks_missing";
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { DEFAULT_RATING, getEloRating } = await import("../elo");
      await expect(getEloRating("db-down-team", "NBA")).resolves.toBe(DEFAULT_RATING);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain("using default rating");
      expect(String(warnSpy.mock.calls[0]?.[1])).not.toContain("Invalid `prisma");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("expires cached ratings after the TTL so worker-written ratings reach the serving process", async () => {
    // Web and worker are separate processes; without a TTL the serving process
    // would keep serving a rating it cached once at boot, never seeing the daily
    // Elo-refresh cron's writes. This proves a stale entry is re-read.
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/clutch_picks_missing";
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const nowSpy = spyOn(Date, "now");
    try {
      const { getEloRating, setEloRating, DEFAULT_RATING } = await import("../elo");
      const team = "ttl-probe-team";
      const sport = "NHL";
      const t0 = 2_000_000_000_000;

      nowSpy.mockReturnValue(t0);
      setEloRating(team, sport, 1720); // seeds the in-memory cache at t0
      expect(await getEloRating(team, sport)).toBe(1720); // fresh → cache hit

      // Still within the 6h TTL → cache hit, value unchanged.
      nowSpy.mockReturnValue(t0 + 60 * 60 * 1000); // +1h
      expect(await getEloRating(team, sport)).toBe(1720);

      // Past the TTL → entry is stale → re-read from DB (unreachable here, so it
      // falls through to the default). The point is it did NOT serve the stale
      // cached 1720 — it went back to the source.
      nowSpy.mockReturnValue(t0 + 7 * 60 * 60 * 1000); // +7h
      expect(await getEloRating(team, sport)).toBe(DEFAULT_RATING);
    } finally {
      warnSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });
});
