import type { PrismaClient } from "@prisma/client";

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
    console.warn(
      "[delete-account] Apple token revocation not configured — skipping. " +
        "Set APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY in Railway to enable. " +
        "Apple Guideline 5.1.1(v) requires this before App Store submission.",
    );
  } catch (err) {
    console.warn(
      "[delete-account] Apple account lookup failed, continuing with deletion:",
      err,
    );
  }
}
