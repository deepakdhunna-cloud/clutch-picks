import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const profileRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Validation schema for profile image update
const updateImageSchema = z.object({
  imageUrl: z.string().url(),
});

// Validation schema for profile update (name, bio, isPrivate)
const updateProfileSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  bio: z.string().max(150).optional(),
  isPrivate: z.boolean().optional(),
});

// GET /api/profile - Get user's profile
profileRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  try {
    const [profile, followersCount, followingCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          bio: true,
          isPrivate: true,
        },
      }),
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
    ]);

    if (!profile) {
      return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
    }

    return c.json({
      data: {
        ...profile,
        followersCount,
        followingCount,
      },
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return c.json(
      { error: { message: "Failed to fetch profile", code: "FETCH_FAILED" } },
      500
    );
  }
});

// PUT /api/profile - Update user's name, bio, and isPrivate
profileRouter.put("/", zValidator("json", updateProfileSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { name, bio, isPrivate } = c.req.valid("json");

  try {
    const updateData: { name?: string; bio?: string; isPrivate?: boolean } = {};
    if (name !== undefined) updateData.name = name;
    if (bio !== undefined) updateData.bio = bio;
    if (isPrivate !== undefined) updateData.isPrivate = isPrivate;

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    const [followersCount, followingCount] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
    ]);

    return c.json({
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        image: updatedUser.image,
        bio: updatedUser.bio,
        isPrivate: updatedUser.isPrivate,
        followersCount,
        followingCount,
      },
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return c.json(
      { error: { message: "Failed to update profile", code: "UPDATE_FAILED" } },
      500
    );
  }
});

// GET /api/profile/:userId - Get another user's profile
profileRouter.get("/:userId", async (c) => {
  const { userId } = c.req.param();
  const currentUser = c.get("user");

  try {
    const [profile, followersCount, followingCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          image: true,
          bio: true,
          isPrivate: true,
        },
      }),
      prisma.follow.count({ where: { followingId: userId } }),
      prisma.follow.count({ where: { followerId: userId } }),
    ]);

    if (!profile) {
      return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
    }

    // Check if current user follows this user (for private profile access)
    let isFollowing = false;
    if (currentUser && currentUser.id !== userId) {
      const follow = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: currentUser.id,
            followingId: userId,
          },
        },
      });
      isFollowing = !!follow;
    }

    // If profile is private and user is not following, return limited data
    if (profile.isPrivate && !isFollowing && currentUser?.id !== userId) {
      return c.json({
        data: {
          id: profile.id,
          name: profile.name,
          image: profile.image,
          bio: null,
          isPrivate: true,
          followersCount,
          followingCount,
          isFollowing,
        },
      });
    }

    return c.json({
      data: {
        ...profile,
        followersCount,
        followingCount,
        isFollowing,
      },
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return c.json(
      { error: { message: "Failed to fetch profile", code: "FETCH_FAILED" } },
      500
    );
  }
});

// PUT /api/profile/image - Update user's profile image
profileRouter.put("/image", zValidator("json", updateImageSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { imageUrl } = c.req.valid("json");

  try {
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { image: imageUrl },
    });

    const [followersCount, followingCount] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
    ]);

    return c.json({
      data: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        image: updatedUser.image,
        bio: updatedUser.bio,
        isPrivate: updatedUser.isPrivate,
        followersCount,
        followingCount,
      },
    });
  } catch (error) {
    console.error("Error updating profile image:", error);
    return c.json(
      { error: { message: "Failed to update profile image", code: "UPDATE_FAILED" } },
      500
    );
  }
});

// DELETE /api/profile/delete-account - Permanently delete user account and all data
profileRouter.delete('/delete-account', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: { message: 'Not authenticated', code: 'UNAUTHORIZED' } }, 401);
  }

  try {
    // Delete all user-related data in order (respecting foreign keys)
    await prisma.userPick.deleteMany({ where: { odId: user.id } });
    await prisma.follow.deleteMany({ where: { OR: [{ followerId: user.id }, { followingId: user.id }] } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.account.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    return c.json({ data: { success: true } });
  } catch (error) {
    console.error('Error deleting account:', error);
    return c.json({ error: { message: 'Failed to delete account', code: 'DELETE_FAILED' } }, 500);
  }
});

export { profileRouter };
