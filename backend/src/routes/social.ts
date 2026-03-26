import { Hono } from "hono";
import { prisma } from "../prisma";
import { auth } from "../auth";

const socialRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

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

    return c.json({
      data: {
        followers: followers.map((f) => f.follower),
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

    return c.json({
      data: {
        following: following.map((f) => f.following),
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
