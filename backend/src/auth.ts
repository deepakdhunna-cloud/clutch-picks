import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, bearer } from "better-auth/plugins";
import { prisma } from "./prisma";
import { env } from "./env";
import { buildOtpEmailContent } from "./lib/authEmail";
import { buildAppleProviderClientSecret } from "./lib/appleAuth";

const appleClientSecret = await buildAppleProviderClientSecret().catch((error) => {
  console.error("[auth] Failed to create Apple client secret", error);
  if (env.NODE_ENV === "production") throw error;
  return null;
});

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BACKEND_URL,
  socialProviders: {
    apple: {
      clientId: env.APPLE_CLIENT_ID ?? "Com.vibecode.clutchpicks-xzrxme",
      clientSecret: appleClientSecret ?? "native-ios-unused",
      appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER ?? "Com.vibecode.clutchpicks-xzrxme",
      async mapProfileToUser(profile) {
        if (profile.email) return {};

        const account = await prisma.account.findFirst({
          where: { providerId: "apple", accountId: profile.sub },
          include: { user: true },
        });

        if (!account?.user?.email) return {};
        return {
          email: account.user.email,
          emailVerified: account.user.emailVerified,
          name: account.user.name,
        };
      },
    },
  },

  trustedOrigins: [
    // Existing dev/App Store builds present the original URL scheme.
    // This is only a local app-origin identifier, not a dependency on any service.
    "vibecode://",
    "clutchpicks://",
    "exp://*/*",
    "exp://",
    "https://clutchpicksapp.com",
    "https://www.clutchpicksapp.com",
    "http://localhost:*",
    "http://127.0.0.1:*",
  ],
  plugins: [
    expo(),
    // Bearer-token auth so native iOS clients can authenticate without
    // depending on Set-Cookie response headers (which NSURLSession can
    // strip before JS sees them, breaking the expo plugin's cookie store).
    // The server emits `set-auth-token` after sign-in; the client
    // captures it and sends `Authorization: Bearer <token>` on requests.
    bearer(),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") return;
        if (!env.RESEND_API_KEY) {
          throw new Error("RESEND_API_KEY is not set — cannot send OTP");
        }
        const { Resend } = await import("resend");
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const url = await import("node:url");

        const resend = new Resend(env.RESEND_API_KEY);

        // Read logo at send-time. File is small (~50KB) and Resend caches
        // outbound; reading once per send is fine and keeps the module
        // import-side-effect-free.
        const here = path.dirname(url.fileURLToPath(import.meta.url));
        const logoPath = path.join(here, "assets", "email-logo.png");
        const logoBuffer = await fs.readFile(logoPath);

        const emailContent = buildOtpEmailContent(otp);
        const { data, error } = await resend.emails.send({
          from: `Clutch Picks <${env.EMAIL_FROM}>`,
          to: email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
          attachments: [
            {
              filename: "logo.png",
              content: logoBuffer,
              contentId: "logo",
            },
          ],
        });
        if (error) {
          throw new Error(`Resend send failed: ${error.message ?? String(error)}`);
        }
        if (!data?.id) {
          throw new Error("Resend returned no message id");
        }
      },
    }),
  ],

  // ============================================
  // REQUIRED: Cross-origin cookie settings
  // Without this, sessions return null in mobile/iframe
  // ============================================
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
    },
    // CSRF protection enabled — Better Auth + Expo plugin handle tokens automatically
    trustedProxyHeaders: true,
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      partitioned: true,
    },
  },
});
