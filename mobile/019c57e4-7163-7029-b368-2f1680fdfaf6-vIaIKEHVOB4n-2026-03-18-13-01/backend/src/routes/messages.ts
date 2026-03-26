import { Hono } from "hono";
import { prisma } from "../prisma";
import { auth } from "../auth";

const messagesRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// GET /api/messages/conversations - Get all conversations for current user
messagesRouter.get("/conversations", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { participant1Id: user.id },
          { participant2Id: user.id },
        ],
      },
      include: {
        participant1: { select: { id: true, name: true, image: true } },
        participant2: { select: { id: true, name: true, image: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const unreadCounts = await Promise.all(
      conversations.map((conv) =>
        prisma.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: user.id },
            readAt: null,
          },
        })
      )
    );

    const result = conversations.map((conv, i) => {
      const other = conv.participant1Id === user.id ? conv.participant2 : conv.participant1;
      const lastMessage = conv.messages[0] ?? null;
      const unreadCount = unreadCounts[i] ?? 0;
      return {
        id: conv.id,
        other,
        lastMessage,
        updatedAt: conv.updatedAt,
        unreadCount,
      };
    });

    return c.json({ data: result });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return c.json({ error: { message: "Failed to fetch conversations", code: "FETCH_FAILED" } }, 500);
  }
});

// POST /api/messages/conversations/:userId - Get or create conversation with a user
messagesRouter.post("/conversations/:userId", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const targetId = c.req.param("userId");
  if (targetId === user.id) {
    return c.json({ error: { message: "Cannot message yourself", code: "INVALID_OPERATION" } }, 400);
  }

  try {
    // Ensure consistent ordering so [A,B] and [B,A] map to the same conversation
    const sorted = [user.id, targetId].sort();
    const p1Id = sorted[0] as string;
    const p2Id = sorted[1] as string;

    let conv = await prisma.conversation.findUnique({
      where: { participant1Id_participant2Id: { participant1Id: p1Id, participant2Id: p2Id } },
    });

    if (!conv) {
      conv = await prisma.conversation.create({
        data: { participant1Id: p1Id, participant2Id: p2Id },
      });
    }

    return c.json({ data: { id: conv.id } });
  } catch (error) {
    console.error("Error creating conversation:", error);
    return c.json({ error: { message: "Failed to create conversation", code: "CREATE_FAILED" } }, 500);
  }
});

// GET /api/messages/conversations/:conversationId/messages - Get messages in a conversation
messagesRouter.get("/conversations/:conversationId/messages", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const conversationId = c.req.param("conversationId");

  try {
    const conv = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ participant1Id: user.id }, { participant2Id: user.id }],
      },
    });

    if (!conv) return c.json({ error: { message: "Not found", code: "NOT_FOUND" } }, 404);

    const msgs = await prisma.message.findMany({
      where: { conversationId },
      include: { sender: { select: { id: true, name: true, image: true } } },
      orderBy: { createdAt: "asc" },
    });

    return c.json({ data: msgs });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return c.json({ error: { message: "Failed to fetch messages", code: "FETCH_FAILED" } }, 500);
  }
});

// POST /api/messages/conversations/:conversationId/messages - Send a message
messagesRouter.post("/conversations/:conversationId/messages", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const conversationId = c.req.param("conversationId");

  try {
    const body = await c.req.json<{ content?: string }>();
    const { content } = body;

    if (!content?.trim()) {
      return c.json({ error: { message: "Content required", code: "CONTENT_REQUIRED" } }, 400);
    }

    const conv = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        OR: [{ participant1Id: user.id }, { participant2Id: user.id }],
      },
    });

    if (!conv) return c.json({ error: { message: "Not found", code: "NOT_FOUND" } }, 404);

    const msg = await prisma.message.create({
      data: { conversationId, senderId: user.id, content: content.trim() },
      include: { sender: { select: { id: true, name: true, image: true } } },
    });

    // Bump conversation updatedAt so it surfaces at the top of the list
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return c.json({ data: msg });
  } catch (error) {
    console.error("Error sending message:", error);
    return c.json({ error: { message: "Failed to send message", code: "SEND_FAILED" } }, 500);
  }
});

export { messagesRouter };
