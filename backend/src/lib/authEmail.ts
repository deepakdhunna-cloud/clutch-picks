export function buildOtpEmailContent(otp: string) {
  return {
    subject: "Your Clutch Picks verification code",
    text: `${otp} is your Clutch Picks verification code.\n\nEnter this code in Clutch Picks to finish signing in.\n\nThis code expires in 5 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;padding:40px 24px;">
        <div style="max-width:480px;margin:0 auto;">
          <div style="text-align:center;margin-bottom:32px;">
            <img src="cid:logo" alt="Clutch Picks" width="180" style="display:inline-block;max-width:180px;height:auto;" />
          </div>
          <p style="color:#ffffff;font-size:18px;line-height:1.5;text-align:center;margin:0 0 24px;font-weight:700;">${otp} is your Clutch Picks verification code.</p>
          <p style="color:#d8d8d8;font-size:15px;line-height:1.6;text-align:center;margin:0 0 28px;">
            Enter this code in Clutch Picks to finish signing in.
          </p>
          <div style="background:#141414;border:1px solid #1f1f1f;border-radius:16px;overflow:hidden;">
            <div style="height:3px;background:linear-gradient(90deg,#8B0A1F 0%,#7A9DB8 100%);"></div>
            <div style="padding:32px 28px;text-align:center;">
              <p style="font-size:11px;color:#7A9DB8;margin:0 0 18px;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Verification Code</p>
              <p style="font-size:42px;font-weight:700;letter-spacing:10px;margin:0;color:#ffffff;font-family:'SF Mono','Menlo','Consolas',monospace;line-height:1;">${otp}</p>
              <p style="font-size:13px;color:#9a9a9a;margin:22px 0 0;">This code expires in 5 minutes.</p>
            </div>
          </div>
          <p style="color:#a0a0a0;font-size:13px;line-height:1.7;text-align:center;margin:28px 0 0;">
            <strong style="color:#e0e0e0;font-weight:600;">Didn't request this code?</strong><br/>
            Someone may have entered your email by mistake. You can safely ignore this email.
          </p>
          <div style="height:1px;background:#1f1f1f;margin:32px 0 20px;"></div>
          <div style="text-align:center;">
            <p style="font-size:11px;color:#888888;margin:0 0 6px;letter-spacing:1.5px;font-weight:600;">Clutch Picks</p>
            <p style="font-size:11px;color:#666666;margin:0;letter-spacing:0.5px;">AI-powered sports predictions</p>
          </div>
        </div>
      </div>
    `,
  };
}
