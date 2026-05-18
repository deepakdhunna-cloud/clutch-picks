import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { createNotification } from "./notifications";

const socialRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

const reportSchema = z.object({
  reason: z.string().min(1).max(80).default("objectionable_content"),
  details: z.string().max(500).optional(),
});

export function blockedCounterpartIdsFor(
  userId: string,
  blocks: Array<{ blockerId: string; blockedId: string }>,
): Set<string> {
  return new Set(blocks.map((block) =>
    block.blockerId === userId ? block.blockedId : block.blockerId,
  ));
}

async function hiddenUserIdsFor(userId?: string | null): Promise<Set<string>> {
  if (!userId) return new Set();
  const blocks = await prisma.userBlock.findMany({
    where: {
      OR: [
        { blockerId: userId },
        { blockedId: userId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  return blockedCounterpartIdsFor(userId, blocks);
}

// POST /api/social/follow/:userId - Follow a user
socialRouter.post("/follow/:userId", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const targetUserId = c.req.param("userId");

  if (currentUser.id === targetUserId) {
    return c.json({ error: { message: "Cannot follow yourself", code: "INVALID_OPERATION" } }, 400);
  }

  try {
    const block = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: currentUser.id, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: currentUser.id },
        ],
      },
    });
    if (block) {
      return c.json({ error: { message: "This user cannot be followed", code: "BLOCKED" } }, 400);
    }

    // Check if target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
    }

    // Create follow relationship
    const follow = await prisma.follow.create({
      data: {
        followerId: currentUser.id,
        followingId: targetUserId,
      },
    });

    // Notify the followed user
    createNotification(
      targetUserId,
      "new_follower",
      "New Follower",
      `${currentUser.name ?? "Someone"} started following you`,
      { userId: currentUser.id }
    );

    return c.json({ data: { followed: true, followId: follow.id } });
  } catch (error: unknown) {
    // Check for unique constraint violation (already following)
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return c.json({ error: { message: "Already following this user", code: "ALREADY_FOLLOWING" } }, 400);
    }
    console.error("Error following user:", error);
    return c.json({ error: { message: "Failed to follow user", code: "FOLLOW_FAILED" } }, 500);
  }
});

// POST /api/social/block/:userId - Block a user and remove follow links
socialRouter.post("/block/:userId", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const targetUserId = c.req.param("userId");
  if (currentUser.id === targetUserId) {
    return c.json({ error: { message: "Cannot block yourself", code: "INVALID_OPERATION" } }, 400);
  }

  try {
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!targetUser) {
      return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
    }

    await prisma.$transaction([
      prisma.follow.deleteMany({
        where: {
          OR: [
            { followerId: currentUser.id, followingId: targetUserId },
            { followerId: targetUserId, followingId: currentUser.id },
          ],
        },
      }),
      prisma.userBlock.upsert({
        where: {
          blockerId_blockedId: {
            blockerId: currentUser.id,
            blockedId: targetUserId,
          },
        },
        update: {},
        create: {
          blockerId: currentUser.id,
          blockedId: targetUserId,
        },
      }),
    ]);

    return c.json({ data: { blocked: true } });
  } catch (error) {
    console.error("Error blocking user:", error);
    return c.json({ error: { message: "Failed to block user", code: "BLOCK_FAILED" } }, 500);
  }
});

// DELETE /api/social/block/:userId - Unblock a user
socialRouter.delete("/block/:userId", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const targetUserId = c.req.param("userId");
  try {
    await prisma.userBlock.deleteMany({
      where: { blockerId: currentUser.id, blockedId: targetUserId },
    });
    return c.json({ data: { blocked: false } });
  } catch (error) {
    console.error("Error unblocking user:", error);
    return c.json({ error: { message: "Failed to unblock user", code: "UNBLOCK_FAILED" } }, 500);
  }
});

// GET /api/social/is-blocked/:userId - Check if current user blocked target
socialRouter.get("/is-blocked/:userId", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const targetUserId = c.req.param("userId");
  try {
    const block = await prisma.userBlock.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: currentUser.id,
          blockedId: targetUserId,
        },
      },
    });
    return c.json({ data: { isBlocked: !!block } });
  } catch (error) {
    console.error("Error checking block status:", error);
    return c.json({ error: { message: "Failed to check block status", code: "CHECK_FAILED" } }, 500);
  }
});

// POST /api/social/report/:userId - Report objectionable user content
socialRouter.post("/report/:userId", zValidator("json", reportSchema), async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const targetUserId = c.req.param("userId");
  if (currentUser.id === targetUserId) {
    return c.json({ error: { message: "Cannot report yourself", code: "INVALID_OPERATION" } }, 400);
  }

  const { reason, details } = c.req.valid("json");
  try {
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!targetUser) {
      return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
    }

    await prisma.contentReport.create({
      data: {
        reporterId: currentUser.id,
        reportedUserId: targetUserId,
        reason,
        details,
      },
    });
    return c.json({ data: { reported: true } });
  } catch (error) {
    console.error("Error reporting user:", error);
    return c.json({ error: { message: "Failed to report user", code: "REPORT_FAILED" } }, 500);
  }
});

// DELETE /api/social/unfollow/:userId - Unfollow a user
socialRouter.delete("/unfollow/:userId", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const targetUserId = c.req.param("userId");

  try {
    const deleted = await prisma.follow.deleteMany({
      where: {
        followerId: currentUser.id,
        followingId: targetUserId,
      },
    });

    if (deleted.count === 0) {
      return c.json({ error: { message: "Not following this user", code: "NOT_FOLLOWING" } }, 400);
    }

    return c.json({ data: { unfollowed: true } });
  } catch (error) {
    console.error("Error unfollowing user:", error);
    return c.json({ error: { message: "Failed to unfollow user", code: "UNFOLLOW_FAILED" } }, 500);
  }
});

// GET /api/social/followers/:userId - Get followers list
socialRouter.get("/followers/:userId", async (c) => {
  const targetUserId = c.req.param("userId");
  const currentUser = c.get("user");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const skip = (page - 1) * limit;

  try {
    const [followers, total] = await Promise.all([
      prisma.follow.findMany({
        where: { followingId: targetUserId },
        include: {
          follower: {
            select: {
              id: true,
              name: true,
              image: true,
              bio: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.follow.count({
        where: { followingId: targetUserId },
      }),
    ]);

    const hiddenIds = await hiddenUserIdsFor(currentUser?.id);
    const visibleFollowers = followers
      .map((f) => f.follower)
      .filter((user) => !hiddenIds.has(user.id));

    return c.json({
      data: {
        followers: visibleFollowers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching followers:", error);
    return c.json({ error: { message: "Failed to fetch followers", code: "FETCH_FAILED" } }, 500);
  }
});

// GET /api/social/following/:userId - Get following list
socialRouter.get("/following/:userId", async (c) => {
  const targetUserId = c.req.param("userId");
  const currentUser = c.get("user");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const skip = (page - 1) * limit;

  try {
    const [following, total] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: targetUserId },
        include: {
          following: {
            select: {
              id: true,
              name: true,
              image: true,
              bio: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.follow.count({
        where: { followerId: targetUserId },
      }),
    ]);

    const hiddenIds = await hiddenUserIdsFor(currentUser?.id);
    const visibleFollowing = following
      .map((f) => f.following)
      .filter((user) => !hiddenIds.has(user.id));

    return c.json({
      data: {
        following: visibleFollowing,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching following:", error);
    return c.json({ error: { message: "Failed to fetch following", code: "FETCH_FAILED" } }, 500);
  }
});

// GET /api/social/stats/:userId - Get follower/following counts
socialRouter.get("/stats/:userId", async (c) => {
  const targetUserId = c.req.param("userId");

  try {
    const [followersCount, followingCount] = await Promise.all([
      prisma.follow.count({ where: { followingId: targetUserId } }),
      prisma.follow.count({ where: { followerId: targetUserId } }),
    ]);

    return c.json({
      data: {
        followersCount,
        followingCount,
      },
    });
  } catch (error) {
    console.error("Error fetching social stats:", error);
    return c.json({ error: { message: "Failed to fetch stats", code: "FETCH_FAILED" } }, 500);
  }
});

// GET /api/social/is-following/:userId - Check if current user follows target user
socialRouter.get("/is-following/:userId", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const targetUserId = c.req.param("userId");

  try {
    const block = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: currentUser.id, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: currentUser.id },
        ],
      },
    });
    if (block) return c.json({ data: { isFollowing: false } });

    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: currentUser.id,
          followingId: targetUserId,
        },
      },
    });

    return c.json({ data: { isFollowing: !!follow } });
  } catch (error) {
    console.error("Error checking follow status:", error);
    return c.json({ error: { message: "Failed to check follow status", code: "CHECK_FAILED" } }, 500);
  }
});

export { socialRouter };
