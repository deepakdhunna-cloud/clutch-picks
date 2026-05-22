# Clutch Picks - App Store Release Checklist

This is a release-readiness checklist for the current app. Do not use it as an automated App Store submission script.

## Current App Config

- App name: `CLUTCH PICKS`
- Marketing version: `1.1.1`
- iOS build number: `27`
- Bundle identifier currently in app config: `Com.vibecode.clutchpicks-xzrxme`
- Bundle identifier note: keep this exact identifier for updates to the existing App Store app. Changing it requires a separate App Store app record.
- App URL scheme note: keep the existing installed-app scheme for auth/deep-link compatibility. This is not a Vibe service dependency.
- Tablet support: `false`
- Privacy policy/support URL: `https://www.clutchpicksapp.com`

## App Store Metadata

### App Name
`Clutch Picks - Sports Predictions`

### Subtitle
`AI Sports Predictions & Stats`

### Keywords
`sports,picks,predictions,football,basketball,baseball,hockey,soccer,NFL,NBA,MLB,NHL,analysis,stats`

### Description

```
All predictions are AI-generated for entertainment and informational purposes only. Clutch Picks does not facilitate gambling.

Make smarter sports picks with Clutch Picks, your companion for AI-powered game analysis across major sports.

TRACK YOUR FAVORITE SPORTS
- NFL, NBA, MLB, NHL, MLS, EPL, IPL, Tennis, college football, and college basketball
- Live scores and real-time game updates
- Box scores, stats, and matchup details

CLUTCH PICKS FEATURE
Get AI-powered game predictions with confidence ratings to help inform your picks. See detailed analysis for each matchup including team records, recent performance, and key factors.

MAKE YOUR PICKS
- Browse today's games across supported sports
- Make your picks before games start
- Track your win rate and prediction streaks
- Compare your record with other users

SOCIAL FEATURES
- Follow other users and see public profiles
- Report objectionable profiles or content
- Block users you do not want to interact with

LIVE GAME TRACKING
- Real-time score updates
- Live game status indicators
- Where-to-watch information when available

Predictions are for entertainment and informational purposes only. Past prediction accuracy does not guarantee future results.
```

### Promotional Text
`AI-powered sports picks, live scores, matchup analysis, and personal pick tracking across major leagues.`

### What's New - Version 1.1.1

```
- Expanded sports coverage and live game details
- Improved Clutch Picks analysis and confidence displays
- Added notification preference controls
- Improved account deletion and privacy controls
- Added profile report and block safety tools
- Subscription and restore-purchase reliability improvements
- Bug fixes and performance improvements
```

## App Information

- Primary category: Sports
- Secondary category: Entertainment
- Suggested age rating: complete App Store Connect questionnaire truthfully; predictions are entertainment-only and no real-money wagering is supported.
- Gambling disclaimer: Clutch Picks does not offer gambling services, accept wagers, process betting payments, or facilitate real-money betting or trading.

## Subscription Metadata

- Subscription display name: `Clutch Picks Pro`
- Product type: auto-renewable monthly subscription
- US price: `$6.99/month`
- Trial: 3-day free trial for eligible users
- User-facing entitlement/access: AI predictions, confidence ratings, detailed game analysis, live scores, stats, and where-to-watch information
- Required links: Terms and Privacy Policy are available in-app and should also be linked in App Store Connect subscription metadata.

## Screenshot Requirements

Because `supportsTablet` is currently `false`, prepare iPhone screenshots. Add iPad screenshots only if tablet support is enabled later.

Recommended screens:

1. Home screen with today's games
2. Clutch Picks / premium analysis
3. Game detail with prediction and confidence
4. Live scores / box score
5. Profile and pick stats
6. Notification settings
7. Report/block safety flow if App Review asks about UGC controls

## RevenueCat Checklist

- Current Offering exists and is marked current/default.
- Current Offering contains package `$rc_monthly`.
- `$rc_monthly` is backed by the App Store monthly subscription product.
- App Store monthly subscription product is priced at `$6.99/month` in the US storefront.
- App Store product has a 3-day free trial introductory offer.
- Entitlement identifier exactly matches `Clutch Picks Pro`.
- Monthly product is attached to the `Clutch Picks Pro` entitlement.
- App Store Server Notifications are set in RevenueCat with Version 2 for both Production and Sandbox.
- RevenueCat webhook is configured to hit `https://clutch-picks-production.up.railway.app/api/webhooks/revenuecat`.
- RevenueCat webhook Authorization header exactly matches production `REVENUECAT_WEBHOOK_AUTH`.
- Production backend has `REVENUECAT_SECRET_KEY` and `REVENUECAT_WEBHOOK_AUTH` set.
- TestFlight purchase, trial start, restore purchases, and cancellation/expiration webhook flow are verified.

## Backend/Environment Checklist

- Run `cd backend && bun run release:check:production` before submitting. It verifies the Railway production environment and only reports which keys are present/missing; it does not print secret values.
- Deploy database migrations before release.
- Production has `DATABASE_URL` and `BETTER_AUTH_SECRET` set.
- Production has `RESEND_API_KEY` and `EMAIL_FROM` set for OTP email.
- Production has `SHARPAPI_KEY` set for market consensus and calibration.
- Production has Apple revocation vars set: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CLIENT_ID`.
- Production has `UPLOADS_DIR` set to a persistent volume path for profile image uploads.
- Production has verified factor feeds configured: `MLB_UMPIRE_TENDENCY_SOURCE_URL`, `SOCCER_MANAGER_CHANGES_SOURCE_URL`, `UCL_COEFFICIENTS_SOURCE_URL`, `UCL_TEAM_LOCATION_SOURCE_URL`.
- Production has optional monitoring/API vars reviewed: `SENTRY_DSN`, `OPENAI_API_KEY`, `APIFY_API_KEY`, `ANTHROPIC_API_KEY`, `CALIBRATION_ADMIN_KEY`, `INGESTION_ADMIN_KEY`.
- See `DATA_SOURCE_REQUIREMENTS.md` before enabling any table-driven prediction factor.

## Final QA Checklist

- Fresh install, sign up with email OTP.
- Sign in with Apple.
- Onboarding complete and skip paths.
- Paywall loads real App Store product and shows the 3-day trial in the system sheet.
- Purchase trial starts successfully in sandbox/TestFlight.
- Restore purchases works.
- Premium status updates after relaunch and foregrounding.
- Make a pick, view pick history, and profile stats.
- Notification permission request happens from notification settings, not unexpectedly at launch.
- Notification preferences suppress backend push categories.
- Report user and block user controls work.
- Delete account removes local session and backend user data.
- Privacy policy, terms, and support links open correctly.
