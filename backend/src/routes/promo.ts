import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

const promoRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

const redeemSchema = z.object({
  code: z.string().min(1).max(50),
  rcUserId: z.string().optional(),
});

// POST /api/promo/redeem — Redeem a promo code
promoRouter.post("/redeem", zValidator("json", redeemSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { code, rcUserId } = c.req.valid("json");
  const normalizedCode = code.trim().toUpperCase();
  const subscriberId = rcUserId || user.id;

  // Look up the promo code
  const promo = await prisma.promoCode.findUnique({
    where: { code: normalizedCode },
    include: { redemptions: true },
  });

  if (!promo) {
    return c.json({ error: { message: "Invalid promo code", code: "INVALID_CODE" } }, 404);
  }

  // Check if active
  if (!promo.isActive) {
    return c.json({ error: { message: "This promo code is no longer active", code: "INACTIVE" } }, 400);
  }

  // Check if expired
  if (promo.expiresAt && new Date() > promo.expiresAt) {
    return c.json({ error: { message: "This promo code has expired", code: "EXPIRED" } }, 400);
  }

  // Check if maxed out
  if (promo.currentUses >= promo.maxUses) {
    return c.json({ error: { message: "This promo code has reached its maximum uses", code: "MAX_USES" } }, 400);
  }

  // Check if user already redeemed
  const existingRedemption = promo.redemptions.find((r) => r.userId === user.id);
  if (existingRedemption) {
    return c.json({ error: { message: "You've already redeemed this code", code: "ALREADY_REDEEMED" } }, 400);
  }

  // Grant entitlement via RevenueCat
  const rcSecretKey = process.env.REVENUECAT_SECRET_KEY;
  if (!rcSecretKey) {
    console.error("[Promo] REVENUECAT_SECRET_KEY not set");
    return c.json({ error: { message: "Server configuration error", code: "CONFIG_ERROR" } }, 500);
  }

  try {
    const rcResponse = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(subscriberId)}/entitlements/${encodeURIComponent('Clutch Picks Pro')}/promotional`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${rcSecretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ duration: promo.type }),
      }
    );

    if (!rcResponse.ok) {
      const errorText = await rcResponse.text();
      console.error("[Promo] RevenueCat error:", rcResponse.status, errorText);
      return c.json({ error: { message: "Failed to grant subscription. Please try again.", code: "RC_ERROR" } }, 500);
    }

    // Record the redemption and increment uses
    await prisma.$transaction([
      prisma.promoRedemption.create({
        data: {
          promoCodeId: promo.id,
          userId: user.id,
        },
      }),
      prisma.promoCode.update({
        where: { id: promo.id },
        data: { currentUses: { increment: 1 } },
      }),
    ]);

    // Build message based on type
    const messages: Record<string, string> = {
      lifetime: "Lifetime access granted!",
      yearly: "1 year of Clutch Pro granted!",
      monthly: "1 month of Clutch Pro granted!",
      three_day: "3-day trial granted!",
      weekly: "1 week of Clutch Pro granted!",
      two_month: "2 months of Clutch Pro granted!",
      three_month: "3 months of Clutch Pro granted!",
      six_month: "6 months of Clutch Pro granted!",
    };

    return c.json({
      data: {
        success: true,
        message: messages[promo.type] ?? "Clutch Pro access granted!",
        type: promo.type,
      },
    });
  } catch (error: any) {
    console.error("[Promo] Exception:", error?.message || error);
    return c.json({ error: { message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" } }, 500);
  }
});

export { promoRouter };
