import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { resolvePicks } from "../lib/resolve-picks";

const picksRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Validation schemas
const createPickSchema = z.object({
  gameId: z.string().min(1),
  pickedTeam: z.enum(["home", "away"]),
});

// POST /api/picks - Create or update a pick
picksRouter.post("/", zValidator("json", createPickSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { gameId, pickedTeam } = c.req.valid("json");

  try {
    const existing = await prisma.userPick.findUnique({
      where: { odId_gameId: { odId: user.id, gameId } },
    });

    if (existing && existing.result !== null) {
      return c.json(
        { error: { message: "Cannot change a resolved pick", code: "PICK_RESOLVED" } },
        400
      );
    }

    const pick = await prisma.userPick.upsert({
      where: { odId_gameId: { odId: user.id, gameId } },
      update: { pickedTeam },
      create: { odId: user.id, gameId, pickedTeam },
    });

    return c.json({ data: pick });
  } catch (error) {
    console.error("Error creating pick:", error);
    return c.json({ error: { message: "Failed to create pick", code: "CREATE_FAILED" } }, 500);
  }
});

// GET /api/picks - Get all picks for current user
picksRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  try {
    const picks = await prisma.userPick.findMany({
      where: { odId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return c.json({ data: picks });
  } catch (error) {
    console.error("Error fetching picks:", error);
    return c.json({ error: { message: "Failed to fetch picks", code: "FETCH_FAILED" } }, 500);
  }
});

// GET /api/picks/stats - Get user stats
picksRouter.get("/stats", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  try {
    const picks = await prisma.userPick.findMany({
      where: { odId: user.id },
      orderBy: { createdAt: "desc" },
    });

    const picksMade = picks.length;
    const wins = picks.filter((p) => p.result === "win").length;
    const losses = picks.filter((p) => p.result === "loss").length;
    const winRate = picksMade > 0 && (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

    // Calculate current streak
    let currentStreak = 0;
    let streakType: "win" | "loss" | null = null;

    for (const pick of picks) {
      if (pick.result === null) continue; // Skip unresolved picks

      if (streakType === null) {
        streakType = pick.result as "win" | "loss";
        currentStreak = 1;
      } else if (pick.result === streakType) {
        currentStreak++;
      } else {
        break; // Streak ended
      }
    }

    // Negative streak for losses
    if (streakType === "loss") {
      currentStreak = -currentStreak;
    }

    return c.json({
      data: {
        picksMade,
        wins,
        losses,
        winRate: Math.round(winRate * 100) / 100,
        currentStreak,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return c.json({ error: { message: "Failed to fetch stats", code: "FETCH_FAILED" } }, 500);
  }
});

// GET /api/picks/resolve - Resolve all pending picks against ESPN final scores
picksRouter.get("/resolve", async (c) => {
  try {
    const { resolved, skipped } = await resolvePicks();
    return c.json({ data: { resolved, skipped } });
  } catch (error) {
    console.error("Error resolving picks:", error);
    return c.json({ error: { message: "Failed to resolve picks", code: "RESOLVE_FAILED" } }, 500);
  }
});

// GET /api/picks/user/:userId - Get picks for a specific user (public)
picksRouter.get("/user/:userId", async (c) => {
  const userId = c.req.param("userId");

  try {
    const picks = await prisma.userPick.findMany({
      where: { odId: userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return c.json({ data: picks });
  } catch (error) {
    console.error("Error fetching user picks:", error);
    return c.json({ error: { message: "Failed to fetch picks", code: "FETCH_FAILED" } }, 500);
  }
});

// GET /api/picks/game/:gameId/stats - Get pick statistics for a specific game (public)
picksRouter.get("/game/:gameId/stats", async (c) => {
  const gameId = c.req.param("gameId");

  try {
    const [homePicks, awayPicks] = await Promise.all([
      prisma.userPick.count({
        where: { gameId, pickedTeam: "home" },
      }),
      prisma.userPick.count({
        where: { gameId, pickedTeam: "away" },
      }),
    ]);

    const totalPicks = homePicks + awayPicks;
    const homePercentage = totalPicks === 0
      ? 50
      : Math.round((homePicks / totalPicks) * 1000) / 10;
    const awayPercentage = totalPicks === 0
      ? 50
      : Math.round((awayPicks / totalPicks) * 1000) / 10;

    return c.json({
      data: {
        gameId,
        homePicks,
        awayPicks,
        totalPicks,
        homePercentage,
        awayPercentage,
      },
    });
  } catch (error) {
    console.error("Error fetching game pick stats:", error);
    return c.json({ error: { message: "Failed to fetch game stats", code: "FETCH_FAILED" } }, 500);
  }
});

export { picksRouter };
