import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const newsRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Validation schema for creating news
const createNewsSchema = z.object({
  playerId: z.string().min(1),
  playerName: z.string().min(1),
  teamId: z.string().min(1),
  sport: z.string().min(1),
  headline: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  impact: z.number().int().min(1).max(10),
});

// GET /api/news - Get recent news (affects confidence)
newsRouter.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const sport = c.req.query("sport");
  const sentiment = c.req.query("sentiment");
  const skip = (page - 1) * limit;

  try {
    const where: {
      sport?: string;
      sentiment?: string;
    } = {};

    if (sport) where.sport = sport;
    if (sentiment) where.sentiment = sentiment;

    const [news, total] = await Promise.all([
      prisma.playerNews.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.playerNews.count({ where }),
    ]);

    return c.json({
      data: {
        news,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching news:", error);
    return c.json({ error: { message: "Failed to fetch news", code: "FETCH_FAILED" } }, 500);
  }
});

// GET /api/news/team/:teamId - Get news for specific team
newsRouter.get("/team/:teamId", async (c) => {
  const teamId = c.req.param("teamId");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const skip = (page - 1) * limit;

  try {
    const [news, total] = await Promise.all([
      prisma.playerNews.findMany({
        where: { teamId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.playerNews.count({ where: { teamId } }),
    ]);

    return c.json({
      data: {
        news,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching team news:", error);
    return c.json({ error: { message: "Failed to fetch team news", code: "FETCH_FAILED" } }, 500);
  }
});

// POST /api/news - Add news (for seeding/admin)
newsRouter.post("/", zValidator("json", createNewsSchema), async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const dbUser = await prisma.user.findUnique({ where: { id: currentUser.id }, select: { role: true } });
  if (dbUser?.role !== "admin") {
    return c.json({ error: { message: "Admin access required", code: "FORBIDDEN" } }, 403);
  }

  const newsData = c.req.valid("json");

  try {
    const news = await prisma.playerNews.create({
      data: newsData,
    });

    return c.json({ data: news });
  } catch (error) {
    console.error("Error creating news:", error);
    return c.json({ error: { message: "Failed to create news", code: "CREATE_FAILED" } }, 500);
  }
});

// GET /api/news/player/:playerId - Get news for specific player
newsRouter.get("/player/:playerId", async (c) => {
  const playerId = c.req.param("playerId");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const skip = (page - 1) * limit;

  try {
    const [news, total] = await Promise.all([
      prisma.playerNews.findMany({
        where: { playerId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.playerNews.count({ where: { playerId } }),
    ]);

    return c.json({
      data: {
        news,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching player news:", error);
    return c.json({ error: { message: "Failed to fetch player news", code: "FETCH_FAILED" } }, 500);
  }
});

export { newsRouter };
