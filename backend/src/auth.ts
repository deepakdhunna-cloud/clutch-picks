import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, bearer } from "better-auth/plugins";
import { prisma } from "./prisma";
import { env } from "./env";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BACKEND_URL,
  socialProviders: {
    apple: {
      clientId: "Com.vibecode.clutchpicks-xzrxme",
      clientSecret: "native-ios-unused",
    },
  },

  // ============================================
  // REQUIRED: All trustedOrigins below are needed
  // ============================================
  trustedOrigins: [
    "vibecode://*/*",           // Mobile deep links - REQUIRED
    "exp://*/*",                // Expo development - REQUIRED
    "http://localhost:*",
    "http://127.0.0.1:*",
    "https://*.dev.vibecode.run",
    "https://*.vibecode.run",
    "https://*.vibecodeapp.com",
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

        const { data, error } = await resend.emails.send({
          from: `Clutch Picks <${env.EMAIL_FROM}>`,
          to: email,
          subject: "Your Clutch Picks verification code",
          text: `Your Clutch Picks verification code is ${otp}\n\nThis code expires in 5 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`,
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;padding:40px 24px;">
              <div style="max-width:480px;margin:0 auto;">
                <div style="text-align:center;margin-bottom:32px;">
                  <img src="cid:logo" alt="Clutch Picks" width="180" style="display:inline-block;max-width:180px;height:auto;" />
                </div>
                <p style="color:#d8d8d8;font-size:15px;line-height:1.6;text-align:center;margin:0 0 28px;">
                  Use the code below to finish signing in to Clutch Picks.
                </p>
                <div style="background:#141414;border:1px solid #1f1f1f;border-radius:16px;overflow:hidden;">
                  <div style="height:3px;background:linear-gradient(90deg,#8B0A1F 0%,#7A9DB8 100%);"></div>
                  <div style="padding:32px 28px;text-align:center;">
                    <p style="font-size:11px;color:#7A9DB8;margin:0 0 18px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Verification Code</p>
                    <p style="font-size:42px;font-weight:700;letter-spacing:10px;margin:0;color:#ffffff;font-family:'SF Mono','Menlo','Consolas',monospace;line-height:1;">${otp}</p>
                    <p style="font-size:13px;color:#9a9a9a;margin:22px 0 0;">Expires in 5 minutes</p>
                  </div>
                </div>
                <p style="color:#a0a0a0;font-size:13px;line-height:1.7;text-align:center;margin:28px 0 0;">
                  <strong style="color:#e0e0e0;font-weight:600;">Didn't request this code?</strong><br/>
                  Someone may have entered your email by mistake. You can safely ignore this email — no account action will be taken on your behalf.
                </p>
                <div style="height:1px;background:#1f1f1f;margin:32px 0 20px;"></div>
                <div style="text-align:center;">
                  <p style="font-size:11px;color:#888888;margin:0 0 6px;letter-spacing:1.5px;font-weight:600;">CLUTCH PICKS</p>
                  <p style="font-size:11px;color:#666666;margin:0;letter-spacing:0.5px;">AI-powered sports predictions</p>
                </div>
              </div>
            </div>
          `,
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
