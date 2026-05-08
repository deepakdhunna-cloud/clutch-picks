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
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;padding:48px 24px;">
              <div style="max-width:480px;margin:0 auto;">
                <div style="text-align:center;margin-bottom:36px;">
                  <img src="cid:logo" alt="Clutch Picks" width="220" style="display:inline-block;max-width:220px;height:auto;" />
                </div>
                <div style="background:#141414;border:1px solid #1f1f1f;border-radius:16px;overflow:hidden;">
                  <div style="height:3px;background:linear-gradient(90deg,#8B0A1F 0%,#7A9DB8 100%);"></div>
                  <div style="padding:36px 32px;text-align:center;">
                    <p style="font-size:11px;color:#7A9DB8;margin:0 0 18px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Verification Code</p>
                    <p style="font-size:44px;font-weight:700;letter-spacing:10px;margin:0;color:#ffffff;font-family:'SF Mono','Menlo','Consolas',monospace;line-height:1;">${otp}</p>
                    <p style="font-size:13px;color:#707070;margin:24px 0 0;">Expires in 5 minutes</p>
                  </div>
                </div>
                <p style="font-size:12px;color:#505050;text-align:center;margin:28px 0 0;line-height:1.6;">
                  If you didn't request this code, you can safely ignore this email.<br/>
                  Someone may have entered your email address by mistake.
                </p>
                <p style="font-size:11px;color:#3a3a3a;text-align:center;margin:24px 0 0;letter-spacing:1px;">
                  CLUTCH PICKS · AI SPORTS PREDICTIONS
                </p>
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
