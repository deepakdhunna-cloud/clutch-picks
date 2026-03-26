import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const teamFollowsRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// GET /api/team-follows - Get all teams followed by current user
teamFollowsRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const follows = await prisma.teamFollow.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return c.json({ data: follows });
});

// POST /api/team-follows - Follow a team
teamFollowsRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      teamId: z.string(),
      teamName: z.string(),
      teamAbbreviation: z.string(),
      sport: z.string(),
    })
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
    }

    const { teamId, teamName, teamAbbreviation, sport } = c.req.valid("json");

    try {
      const follow = await prisma.teamFollow.create({
        data: {
          userId: user.id,
          teamId,
          teamName,
          teamAbbreviation,
          sport,
        },
      });

      return c.json({ data: follow });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        return c.json({ error: { message: "Already following this team", code: "ALREADY_FOLLOWING" } }, 400);
      }
      console.error("Error following team:", error);
      return c.json({ error: { message: "Failed to follow team", code: "FOLLOW_FAILED" } }, 500);
    }
  }
);

// DELETE /api/team-follows/:teamId - Unfollow a team
teamFollowsRouter.delete("/:teamId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const teamId = c.req.param("teamId");

  try {
    await prisma.teamFollow.deleteMany({
      where: { userId: user.id, teamId },
    });

    return c.json({ data: { unfollowed: true } });
  } catch (error) {
    console.error("Error unfollowing team:", error);
    return c.json({ error: { message: "Failed to unfollow team", code: "UNFOLLOW_FAILED" } }, 500);
  }
});

export { teamFollowsRouter };
