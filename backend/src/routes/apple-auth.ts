import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { decodeJwt } from "jose";
import { z } from "zod";
import { auth } from "../auth";
import { prisma } from "../prisma";
import { buildAppleAccountTokenUpdate, exchangeAppleAuthorizationCode } from "../lib/appleAuth";

const nativeTokenSchema = z.object({
  identityToken: z.string().min(1),
  authorizationCode: z.string().min(1),
});

export const appleAuthRouter = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

appleAuthRouter.post("/native-token", zValidator("json", nativeTokenSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }

  const { identityToken, authorizationCode } = c.req.valid("json");
  const identityClaims = (() => {
    try {
      return decodeJwt(identityToken);
    } catch {
      return null;
    }
  })();
  const appleSubject = typeof identityClaims?.sub === "string" ? identityClaims.sub : null;
  if (!appleSubject) {
    return c.json({ error: { message: "Invalid Apple identity token", code: "INVALID_APPLE_TOKEN" } }, 400);
  }

  const account = await prisma.account.findFirst({
    where: {
      userId: user.id,
      providerId: "apple",
      accountId: appleSubject,
    },
    select: { id: true },
  });
  if (!account) {
    return c.json(
      { error: { message: "Apple account is not linked to this user", code: "APPLE_ACCOUNT_NOT_LINKED" } },
      409,
    );
  }

  try {
    const tokenResponse = await exchangeAppleAuthorizationCode(authorizationCode);
    if (tokenResponse.id_token) {
      const exchangedClaims = decodeJwt(tokenResponse.id_token);
      if (exchangedClaims.sub !== appleSubject) {
        return c.json(
          { error: { message: "Apple token subject mismatch", code: "APPLE_SUBJECT_MISMATCH" } },
          400,
        );
      }
    }

    await prisma.account.update({
      where: { id: account.id },
      data: buildAppleAccountTokenUpdate({ tokenResponse, identityToken }),
    });

    return c.json({
      data: {
        status: "stored",
        hasAccessToken: Boolean(tokenResponse.access_token),
        hasRefreshToken: Boolean(tokenResponse.refresh_token),
      },
    });
  } catch (error) {
    console.error("[apple-auth] native Apple token exchange failed", { userId: user.id, error });
    return c.json(
      { error: { message: "Apple sign in could not be completed", code: "APPLE_TOKEN_EXCHANGE_FAILED" } },
      502,
    );
  }
});
