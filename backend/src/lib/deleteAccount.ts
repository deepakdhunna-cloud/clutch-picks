import type { PrismaClient } from "@prisma/client";
import { revokeAppleToken } from "./appleAuth";
import { features } from "../env";

// Narrow prisma dependency — just the pieces we touch. Production callers
// pass the real PrismaClient (satisfies structurally); tests cast a mock.
export type DeleteAccountPrisma = Pick<PrismaClient, "$transaction" | "account">;

// Hard-deletes a user and all identifiable data. App Store Guideline
// 5.1.1(v) requires in-app account deletion for subscription apps.
//
// Cascade behavior by table:
//   Session, Account, UserPick, Follow, PushToken — onDelete: Cascade
//     in schema.prisma, removed automatically when the User row goes.
//   AppNotification, NotificationLog, TeamFollow — userId field is not
//     a relation, so we deleteMany these manually inside the tx.
//   PromoRedemption — intentionally retained. A deleted user's past
//     promo-code redemptions stay for fraud/accounting audit trails;
//     the row no longer joins to a real user.
//
// The whole operation runs in a single Prisma transaction so either
// everything is gone or nothing is — we never leave the DB with a
// half-deleted account.
export async function deleteUserAccount(
  prisma: DeleteAccountPrisma,
  user: { id: string; email: string },
): Promise<void> {
  console.log(
    `[delete-account] user=${user.id} email=${user.email} deleted at ${new Date().toISOString()}`,
  );

  // Apple Guideline 5.1.1(v) also requires revoking the Apple OAuth
  // token on the provider side when a user deletes their account.
  // That needs a signed client_secret JWT (APPLE_TEAM_ID / APPLE_KEY_ID
  // / APPLE_PRIVATE_KEY) which isn't wired yet — today's auth.ts uses
  // the "native-ios-unused" placeholder. Log so we don't forget, but
  // never let this block the DB deletion.
  await maybeRevokeAppleTokens(prisma, user.id);

  await prisma.$transaction(async (tx) => {
    await tx.appNotification.deleteMany({ where: { userId: user.id } });
    await tx.notificationLog.deleteMany({ where: { userId: user.id } });
    await tx.teamFollow.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });
}

async function maybeRevokeAppleTokens(
  prisma: DeleteAccountPrisma,
  userId: string,
): Promise<void> {
  try {
    const appleAccounts = await prisma.account.findMany({
      where: { userId, providerId: "apple" },
    });
    if (appleAccounts.length === 0) return;

    if (!features.appleRevoke) {
      console.warn(
        "[delete-account] Apple revocation env vars missing — skipping. " +
          "Set APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_ID " +
          "in Railway. Apple Guideline 5.1.1(v).",
      );
      return;
    }

    for (const acct of appleAccounts) {
      const token = acct.refreshToken ?? acct.accessToken ?? null;
      const tokenTypeHint = acct.refreshToken ? "refresh_token" : "access_token";
      const result = await revokeAppleToken({ token, tokenTypeHint });

      if (result.status === "revoked") {
        console.log(
          `[delete-account] apple revoke ok user=${userId} accountId=${acct.id} hint=${tokenTypeHint}`,
        );
      } else if (result.status === "failed") {
        console.warn(
          `[delete-account] apple revoke failed user=${userId} accountId=${acct.id} ` +
            `http=${result.httpStatus} body=${result.body}`,
        );
      } else if (result.status === "error") {
        console.warn(
          `[delete-account] apple revoke error user=${userId} accountId=${acct.id}`,
          result.error,
        );
      } else if (result.status === "skipped") {
        console.warn(
          `[delete-account] apple revoke skipped user=${userId} accountId=${acct.id} reason=${result.reason}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[delete-account] Apple account lookup or revoke flow failed, continuing with deletion:",
      err,
    );
  }
}
