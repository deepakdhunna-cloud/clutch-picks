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
        const resend = new Resend(env.RESEND_API_KEY);
        const { data, error } = await resend.emails.send({
          from: `Clutch Picks <${env.EMAIL_FROM}>`,
          to: email,
          subject: "Your Clutch Picks verification code",
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#ffffff;">
              <div style="text-align:center;margin-bottom:32px;">
                <h1 style="font-size:22px;font-weight:700;letter-spacing:1px;margin:0;color:#ffffff;">CLUTCH PICKS</h1>
              </div>
              <div style="background:#141414;border:1px solid #262626;border-radius:14px;padding:32px;text-align:center;">
                <p style="font-size:14px;color:#a0a0a0;margin:0 0 16px;letter-spacing:0.5px;text-transform:uppercase;">Verification Code</p>
                <p style="font-size:42px;font-weight:700;letter-spacing:8px;margin:0;color:#ffffff;font-family:'SF Mono',Menlo,monospace;">${otp}</p>
                <p style="font-size:13px;color:#707070;margin:24px 0 0;">This code expires in 5 minutes.</p>
              </div>
              <p style="font-size:12px;color:#606060;text-align:center;margin:24px 0 0;line-height:1.5;">
                If you didn't request this code, you can safely ignore this email.
              </p>
            </div>
          `,
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
