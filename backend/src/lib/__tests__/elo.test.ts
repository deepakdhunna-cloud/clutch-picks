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
});
