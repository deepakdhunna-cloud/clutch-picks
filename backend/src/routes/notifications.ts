import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";

const notificationsRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

const notificationPreferencesSchema = z.object({
  gameLive: z.boolean().optional(),
  pickResult: z.boolean().optional(),
  predictionShift: z.boolean().optional(),
  bigGame: z.boolean().optional(),
  streak: z.boolean().optional(),
});

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  gameLive: true,
  pickResult: true,
  predictionShift: true,
  bigGame: true,
  streak: true,
};

const TYPE_TO_PREF_KEY: Record<string, keyof typeof DEFAULT_NOTIFICATION_PREFERENCES> = {
  game_live: "gameLive",
  pick_resolved: "pickResult",
  pick_result: "pickResult",
  winner_flip: "predictionShift",
  big_game: "bigGame",
  streak: "streak",
};

export type NotificationPreferenceKey = keyof typeof DEFAULT_NOTIFICATION_PREFERENCES;
export type NotificationPreferenceValues = typeof DEFAULT_NOTIFICATION_PREFERENCES;

export function notificationPreferenceKeyForType(
  type: string | undefined,
): NotificationPreferenceKey | null {
  if (!type) return null;
  return TYPE_TO_PREF_KEY[type] ?? null;
}

export function mergeNotificationPreferences(
  prefs?: Partial<NotificationPreferenceValues> | null,
): NotificationPreferenceValues {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...prefs };
}

function isExpoPushToken(token: string): boolean {
  return /^(Expo|Exponent)PushToken\[[A-Za-z0-9_.=-]+\]$/.test(token);
}

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

// GET /api/notifications/preferences - Get push preferences
notificationsRouter.get("/preferences", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  try {
    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId: user.id },
      select: {
        gameLive: true,
        pickResult: true,
        predictionShift: true,
        bigGame: true,
        streak: true,
      },
    });
    return c.json({ data: mergeNotificationPreferences(prefs) });
  } catch (error) {
    console.error("[Notifications] Preferences fetch error:", error);
    return c.json({ error: { message: "Failed to fetch preferences", code: "FETCH_FAILED" } }, 500);
  }
});

// PUT /api/notifications/preferences - Update push preferences
notificationsRouter.put("/preferences", zValidator("json", notificationPreferencesSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const prefs = c.req.valid("json");
  try {
    const updated = await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: prefs,
      create: { userId: user.id, ...DEFAULT_NOTIFICATION_PREFERENCES, ...prefs },
      select: {
        gameLive: true,
        pickResult: true,
        predictionShift: true,
        bigGame: true,
        streak: true,
      },
    });
    return c.json({ data: updated });
  } catch (error) {
    console.error("[Notifications] Preferences update error:", error);
    return c.json({ error: { message: "Failed to update preferences", code: "UPDATE_FAILED" } }, 500);
  }
});

// POST /api/notifications/register — Save push token
notificationsRouter.post("/register", zValidator("json", z.object({
  token: z.string().min(1).refine(isExpoPushToken, "Invalid Expo push token"),
  platform: z.enum(["ios", "android"]).default("ios"),
})), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const { token, platform } = c.req.valid("json");
  try {
    await prisma.pushToken.upsert({
      where: { token },
      update: { userId: user.id, platform, updatedAt: new Date() },
      create: { userId: user.id, token, platform },
    });
    return c.json({ data: { success: true } });
  } catch (error) {
    console.error("[Notifications] Register error:", error);
    return c.json({ error: { message: "Failed to register", code: "REGISTER_FAILED" } }, 500);
  }
});

// DELETE /api/notifications/unregister — Remove push token
notificationsRouter.post("/unregister", zValidator("json", z.object({ token: z.string() })), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const { token } = c.req.valid("json");
  try {
    await prisma.pushToken.deleteMany({ where: { token, userId: user.id } });
  } catch (error) {
    console.error("[notifications] Failed to unregister push token:", error);
  }
  return c.json({ data: { success: true } });
});

export { notificationsRouter };

// ─── PUSH NOTIFICATION SENDER ───────────────────────────────
// Uses Expo Push API: https://docs.expo.dev/push-notifications/sending-notifications/

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default';
  badge?: number;
}

interface ExpoPushTicket {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[];
  errors?: Array<{
    message?: string;
    code?: string;
  }>;
}

async function sendPushNotifications(messages: PushMessage[]) {
  if (messages.length === 0) return;
  // Expo accepts batches of 100
  const chunks: PushMessage[][] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }
  for (const chunk of chunks) {
    try {
      const response = await fetchWithTimeout('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
        timeoutMs: 15000,
      });
      const payload = await response.json().catch(() => null) as ExpoPushResponse | null;
      if (!response.ok) {
        console.error('[Push] Expo API error:', response.status, payload?.errors ?? payload);
        continue;
      }

      const invalidTokens: string[] = [];
      const tickets = Array.isArray(payload?.data) ? payload.data : [];
      for (let index = 0; index < tickets.length; index += 1) {
        const ticket = tickets[index];
        if (ticket?.status !== "error") continue;

        const token = chunk[index]?.to;
        const errorCode = ticket.details?.error;
        console.warn('[Push] Expo ticket error:', errorCode ?? "unknown", ticket.message ?? "");
        if (errorCode === "DeviceNotRegistered" && token) {
          invalidTokens.push(token);
        }
      }

      if (invalidTokens.length > 0) {
        await prisma.pushToken.deleteMany({
          where: { token: { in: invalidTokens } },
        });
        console.log(`[Push] Removed ${invalidTokens.length} unregistered push token(s)`);
      }
    } catch (err) {
      console.error('[Push] Send error:', err);
    }
  }
}

async function isPushEnabledForUser(userId: string, type?: string): Promise<boolean> {
  if (!type) return true;
  const prefKey = notificationPreferenceKeyForType(type);
  if (!prefKey) return true;

  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId },
    select: { [prefKey]: true },
  });
  return prefs?.[prefKey] ?? true;
}

// Send push to a specific user
export async function sendPushToUser(userId: string, title: string, body: string, data?: Record<string, any>) {
  try {
    if (!(await isPushEnabledForUser(userId, data?.type))) return;

    const tokens = await prisma.pushToken.findMany({ where: { userId } });
    if (tokens.length === 0) return;

    // Rate limit: max 4 notifications per user per day
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sentToday = await prisma.notificationLog.count({
      where: { userId, sentAt: { gte: todayStart } },
    });
    if (sentToday >= 4) return;

    const messages: PushMessage[] = tokens.map(t => ({
      to: t.token,
      title,
      body,
      data,
      sound: 'default' as const,
    }));

    await sendPushNotifications(messages);

    // Log it
    await prisma.notificationLog.create({
      data: { userId, type: data?.type ?? 'general', gameId: data?.gameId, title, body },
    });
  } catch (err) {
    console.error('[Push] sendPushToUser error:', err);
  }
}

// Send push to all users with tokens (for big game alerts)
export async function sendPushToAll(
  title: string,
  body: string,
  data?: Record<string, any>,
  maxPerUser = 2,
  excludeUserIds: string[] = [],
) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const excluded = new Set(excludeUserIds);

    const allTokens = await prisma.pushToken.findMany({
      include: { user: true },
    });

    // Group by user and check rate limit
    const userTokens = new Map<string, string[]>();
    for (const t of allTokens) {
      const existing = userTokens.get(t.userId) ?? [];
      existing.push(t.token);
      userTokens.set(t.userId, existing);
    }

    const messages: PushMessage[] = [];
    for (const [userId, tokens] of userTokens) {
      if (excluded.has(userId)) continue;
      if (!(await isPushEnabledForUser(userId, data?.type))) continue;

      const sentToday = await prisma.notificationLog.count({
        where: { userId, sentAt: { gte: todayStart } },
      });
      if (sentToday >= maxPerUser) continue; // Skip over-notified users

      for (const token of tokens) {
        messages.push({ to: token, title, body, data, sound: 'default' });
      }

      await prisma.notificationLog.create({
        data: { userId, type: data?.type ?? 'broadcast', gameId: data?.gameId, title, body },
      });
    }

    await sendPushNotifications(messages);
  } catch (err) {
    console.error('[Push] sendPushToAll error:', err);
  }
}

// Helper to create in-app + push notification
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  try {
    // In-app notification
    await prisma.appNotification.create({
      data: {
        userId,
        type,
        title,
        body,
        data: data ? JSON.stringify(data) : null,
      },
    });
    // Push notification
    await sendPushToUser(userId, title, body, { ...data, type });
  } catch (err) {
    console.error("[notification] Failed to create:", err);
  }
}
