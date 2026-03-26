import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const discussionRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// Validation schemas
const createPostSchema = z.object({
  content: z.string().min(1).max(1000),
  imageUrl: z.string().url().optional(),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(500),
});

// GET /api/discussion/posts - Get all posts (paginated)
discussionRouter.get("/posts", async (c) => {
  const currentUser = c.get("user");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const skip = (page - 1) * limit;

  try {
    const [posts, total] = await Promise.all([
      prisma.discussionPost.findMany({
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          _count: {
            select: {
              likes: true,
              comments: true,
            },
          },
          likes: currentUser
            ? {
                where: { userId: currentUser.id },
                select: { id: true },
              }
            : false,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.discussionPost.count(),
    ]);

    const formattedPosts = posts.map((post) => ({
      id: post.id,
      content: post.content,
      imageUrl: post.imageUrl,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      user: post.user,
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      isLiked: currentUser ? post.likes.length > 0 : false,
      isOwner: currentUser ? post.userId === currentUser.id : false,
    }));

    return c.json({
      data: {
        posts: formattedPosts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    return c.json({ error: { message: "Failed to fetch posts", code: "FETCH_FAILED" } }, 500);
  }
});

// POST /api/discussion/posts - Create a post
discussionRouter.post("/posts", zValidator("json", createPostSchema), async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { content, imageUrl } = c.req.valid("json");

  try {
    const post = await prisma.discussionPost.create({
      data: {
        userId: currentUser.id,
        content,
        imageUrl,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return c.json({
      data: {
        id: post.id,
        content: post.content,
        imageUrl: post.imageUrl,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        user: post.user,
        likesCount: 0,
        commentsCount: 0,
        isLiked: false,
        isOwner: true,
      },
    });
  } catch (error) {
    console.error("Error creating post:", error);
    return c.json({ error: { message: "Failed to create post", code: "CREATE_FAILED" } }, 500);
  }
});

// DELETE /api/discussion/posts/:id - Delete own post
discussionRouter.delete("/posts/:id", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const postId = c.req.param("id");

  try {
    const post = await prisma.discussionPost.findUnique({
      where: { id: postId },
    });

    if (!post) {
      return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
    }

    if (post.userId !== currentUser.id) {
      return c.json({ error: { message: "Cannot delete another user's post", code: "FORBIDDEN" } }, 403);
    }

    await prisma.discussionPost.delete({
      where: { id: postId },
    });

    return c.json({ data: { deleted: true } });
  } catch (error) {
    console.error("Error deleting post:", error);
    return c.json({ error: { message: "Failed to delete post", code: "DELETE_FAILED" } }, 500);
  }
});

// POST /api/discussion/posts/:id/like - Like a post
discussionRouter.post("/posts/:id/like", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const postId = c.req.param("id");

  try {
    // Check if post exists
    const post = await prisma.discussionPost.findUnique({
      where: { id: postId },
    });

    if (!post) {
      return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
    }

    // Create like
    await prisma.discussionLike.create({
      data: {
        userId: currentUser.id,
        postId,
      },
    });

    const likesCount = await prisma.discussionLike.count({
      where: { postId },
    });

    return c.json({ data: { liked: true, likesCount } });
  } catch (error: unknown) {
    // Check for unique constraint violation (already liked)
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return c.json({ error: { message: "Already liked this post", code: "ALREADY_LIKED" } }, 400);
    }
    console.error("Error liking post:", error);
    return c.json({ error: { message: "Failed to like post", code: "LIKE_FAILED" } }, 500);
  }
});

// DELETE /api/discussion/posts/:id/like - Unlike a post
discussionRouter.delete("/posts/:id/like", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const postId = c.req.param("id");

  try {
    const deleted = await prisma.discussionLike.deleteMany({
      where: {
        userId: currentUser.id,
        postId,
      },
    });

    if (deleted.count === 0) {
      return c.json({ error: { message: "Not liked this post", code: "NOT_LIKED" } }, 400);
    }

    const likesCount = await prisma.discussionLike.count({
      where: { postId },
    });

    return c.json({ data: { unliked: true, likesCount } });
  } catch (error) {
    console.error("Error unliking post:", error);
    return c.json({ error: { message: "Failed to unlike post", code: "UNLIKE_FAILED" } }, 500);
  }
});

// GET /api/discussion/posts/:id/comments - Get comments on a post
discussionRouter.get("/posts/:id/comments", async (c) => {
  const postId = c.req.param("id");
  const currentUser = c.get("user");
  const page = Math.max(1, parseInt(c.req.query("page") || "1"));
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const skip = (page - 1) * limit;

  try {
    // Check if post exists
    const post = await prisma.discussionPost.findUnique({
      where: { id: postId },
    });

    if (!post) {
      return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
    }

    const [comments, total] = await Promise.all([
      prisma.discussionComment.findMany({
        where: { postId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
        skip,
        take: limit,
      }),
      prisma.discussionComment.count({
        where: { postId },
      }),
    ]);

    const formattedComments = comments.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      user: comment.user,
      isOwner: currentUser ? comment.userId === currentUser.id : false,
    }));

    return c.json({
      data: {
        comments: formattedComments,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    return c.json({ error: { message: "Failed to fetch comments", code: "FETCH_FAILED" } }, 500);
  }
});

// POST /api/discussion/posts/:id/comments - Add comment
discussionRouter.post("/posts/:id/comments", zValidator("json", createCommentSchema), async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const postId = c.req.param("id");
  const { content } = c.req.valid("json");

  try {
    // Check if post exists
    const post = await prisma.discussionPost.findUnique({
      where: { id: postId },
    });

    if (!post) {
      return c.json({ error: { message: "Post not found", code: "NOT_FOUND" } }, 404);
    }

    const comment = await prisma.discussionComment.create({
      data: {
        userId: currentUser.id,
        postId,
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    return c.json({
      data: {
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt,
        user: comment.user,
        isOwner: true,
      },
    });
  } catch (error) {
    console.error("Error creating comment:", error);
    return c.json({ error: { message: "Failed to create comment", code: "CREATE_FAILED" } }, 500);
  }
});

// DELETE /api/discussion/comments/:id - Delete own comment
discussionRouter.delete("/comments/:id", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const commentId = c.req.param("id");

  try {
    const comment = await prisma.discussionComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      return c.json({ error: { message: "Comment not found", code: "NOT_FOUND" } }, 404);
    }

    if (comment.userId !== currentUser.id) {
      return c.json({ error: { message: "Cannot delete another user's comment", code: "FORBIDDEN" } }, 403);
    }

    await prisma.discussionComment.delete({
      where: { id: commentId },
    });

    return c.json({ data: { deleted: true } });
  } catch (error) {
    console.error("Error deleting comment:", error);
    return c.json({ error: { message: "Failed to delete comment", code: "DELETE_FAILED" } }, 500);
  }
});

export { discussionRouter };
