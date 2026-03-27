import { Hono } from "hono";
import { prisma } from "../prisma";
import { auth } from "../auth";

const notificationsRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// GET /api/notifications - Get notifications for current user
notificationsRouter.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  try {
    const notifications = await prisma.appNotification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return c.json({ data: notifications });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return c.json({ error: { message: "Failed to fetch notifications", code: "FETCH_FAILED" } }, 500);
  }
});

// GET /api/notifications/unread-count - Get unread count
notificationsRouter.get("/unread-count", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  try {
    const count = await prisma.appNotification.count({
      where: { userId: user.id, read: false },
    });
    return c.json({ data: { count } });
  } catch (error) {
    return c.json({ error: { message: "Failed to fetch count", code: "FETCH_FAILED" } }, 500);
  }
});

// POST /api/notifications/mark-read - Mark all as read
notificationsRouter.post("/mark-read", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  try {
    await prisma.appNotification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return c.json({ data: { success: true } });
  } catch (error) {
    return c.json({ error: { message: "Failed to mark read", code: "UPDATE_FAILED" } }, 500);
  }
});

export { notificationsRouter };

// Helper to create notifications from other routes/jobs
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  try {
    await prisma.appNotification.create({
      data: {
        userId,
        type,
        title,
        body,
        data: data ? JSON.stringify(data) : null,
      },
    });
  } catch (err) {
    console.error("[notification] Failed to create:", err);
  }
}
