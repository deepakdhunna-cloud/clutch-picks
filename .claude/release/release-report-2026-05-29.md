# Release Gate Report — Clutch Picks

- **Date:** 2026-05-29
- **Branch / HEAD:** `codex/fix-projection-engine` @ `11f1701` (clean working tree, 14 commits ahead of `main`)
- **Target build:** v**1.1.1** (build **41**, from `app.config.js` ← `EXPO_IOS_BUILD_NUMBER`)
- **Bundle id:** `Com.vibecode.clutchpicks-xzrxme` · **ascAppId:** `6759183746`
- **Backend:** `https://clutch-picks-production.up.railway.app` (Railway)

---

## VERDICT: 🔴 NO-GO — 3 blockers

Do not submit. The projection engine is in a mid-flight, self-contradictory state:
production is serving illegal predictions, it is not on one coherent engine version,
and the branch's own frontend test suite is red on the exact code paths involved.
Everything else (typecheck, backend tests, health, security, store-compliance,
build config) is green.

---

## BLOCKERS (must fix before submission)

### B1 — Production prediction invariant sweep FAILS (102 illegal predictions live)
- **Evidence:** `qa:predictions:production` exits **1**. `issueCount: 102` out of `204` predicted games (~50%). Representative issue: `projectedTotal 3 is outside TENNIS bounds 16-38` across many tennis games (e.g. `175869`, `tennis-explorer-3218589`, `175530`, …).
- **Not just stale data:** of 50 sampled failing games, **3 are on the current `2.11.0` engine** and 47 carry no version stamp — the branch's own engine still trips the sweep.
- **Interpretation:** either the tennis projections are wrong, *or* the invariant bounds (16–38, games-based) are stale relative to the new set-score model (commit "Tennis: project a real set score 2-0/2-1"). Either way the project's own release QA gate is **red** and cannot certify a release.
- **Routes to:** `prediction-engine-doctor` (reconcile the tennis set-score model with the invariant bounds so the sweep is green and meaningful).

### B2 — Engine-version incoherence in live `/api/games`
- **Evidence:** 207 games served as **148 with NO `modelVersion` stamp (71%)**, **30 on stale `2.10.0-source-aware-availability`**, **27 on `2.11.0-self-learning-calibration`**. The same sport is split across all three (TENNIS: 100 unstamped / 23 @2.10 / 26 @2.11; MLB: 45 unstamped / 6 @2.10).
- **Source at HEAD** declares `MODEL_VERSION = "2.11.0-self-learning-calibration"`, so 2.10.0 + unstamped predictions are incoherent with the intended engine.
- **Release-gate law:** "ONE engine version live across the payload — a version MIX is a blocker; production must be coherent."
- **Routes to:** `prediction-engine-doctor` + backend deploy/cache (recompute or invalidate stale predictions; ensure every prediction carries the current `modelVersion`).

### B3 — Frontend test suite is RED (4 failures, all user-facing projection display)
- **Evidence (`bun test src` → 93 pass / 4 fail):**
  - `canonical-result.test.ts` — tennis label expected **"Projected Games"**, got **"Projected Sets"**.
  - `canonical-result.test.ts` — tennis homeScore expected **"10.2"**, got **"10"** (decimals dropped).
  - `canonical-result.test.ts` — cricket total expected **"354 runs"**, got **"353 runs"** (sum off-by-one).
  - `GameCardRaisedBorder.test.ts` — projected-score away-vs-home order assertion no longer matches `GameCard.tsx`.
- The committed code and committed tests **contradict each other** on tennis/cricket projection display. Shipping with a red suite on the screens users actually read is not acceptable; resolve which is correct (likely the same decision as B1).
- **Routes to:** `prediction-engine-doctor` (model intent) / `production-finisher` (display + test reconciliation).

---

## WARNINGS (shippable, but decide knowingly)

- **W1 — Stale build number in app.json.** `app.json` statically says `buildNumber: "30"`, but `app.config.js` overrides it with `EXPO_IOS_BUILD_NUMBER` (41 in eas prod env). Functionally the build ships as 41; the `30` is misleading config and should be reconciled.
- **W2 — Unpredicted games on primary endpoints.** `/api/games` 206 games / 203–204 predicted; `/api/games/date/...` 76 / 75. A few games have no prediction — confirm the UI shows a clean "unavailable" state (no blank/NaN).
- **W3 — Large games payload (~1.4MB uncompressed).** Confirm gzip/brotli on the wire; heavy for mobile data otherwise. (→ `app-quality-engineer` only if compression isn't on.)
- **W4 — RevenueCat key-selection comment is stale.** `revenuecatClient.ts` doc claims `__DEV__`-based selection, but `selectRevenueCatApiKey` uses `appleKey ?? testKey` and ignores `__DEV__`. Prod is safe (Apple key set → test key never ships), but **dev builds also use the prod RC key**. Fix the comment or the logic for clarity.
- **W5 — Calibration depth not audited this pass.** `/api/calibration` returns 200 / 24KB, but Brier scores / weak-league claims were not deep-reviewed. Confirm no UI overstates accuracy for borderline leagues.

---

## AUTOMATED CHECKS — pass/fail

| Check | Result |
|---|---|
| Typecheck (frontend + backend) | ✅ PASS (clean) |
| Backend tests (`bun test`) | ✅ 456 pass / 0 fail (52 files) |
| Frontend tests (`bun test src`) | 🔴 93 pass / **4 fail** → **B3** |
| Backend health `/health` | ✅ 200 (note: `/api/health` is 404; real route is `/health`) |
| `/api/games` latency | ✅ 0.35–0.5s warm (6.9s cold start) |
| `/api/calibration` | ✅ 200, 0.3s |
| Production invariant sweep | 🔴 **FAIL — exit 1, 102 issues** → **B1** |
| Engine-version coherence | 🔴 **MIX (2.10 / 2.11 / unstamped)** → **B2** |
| Secret scan (source) | ✅ only `EXPO_PUBLIC_*` RC keys (publishable by design) |
| Secret scan (git history) | ✅ no live secrets (`sk-test` is a test fixture) |
| Env hygiene | ✅ `.env` gitignored; only `backend/.env.example` tracked |
| Trademark assets | ✅ only Clutch's own logos + brand-locked `icon.png`; no league/team marks |
| Gambling-adjacent language | ✅ none found in `src/` |
| Error boundary | ✅ `ErrorBoundary.tsx` wired into `_layout.tsx` + key screens |
| `expo lint` | ✅ 0 errors / 67 warnings (incl. dead `tennisProjectionScores` in `projection-display.ts` — corroborates unfinished tennis path) |
| `releaseReadiness.ts` (prod) | ⚠️ NOT RUN — needs Railway prod env (`release:check:production`) |

---

## MANUAL CONFIRM (Deepak — I cannot verify these; do not treat as passed)

- [ ] App Store Connect: metadata, screenshots, **privacy nutrition labels / data disclosure**, age rating, export compliance (`ITSAppUsesNonExemptEncryption:false` is set in app.json — confirm it's still true).
- [ ] Signing & provisioning profiles valid for `Com.vibecode.clutchpicks-xzrxme`.
- [ ] Build **41** actually uploaded **and 41 > last accepted submission** (avoid duplicate-build rejection).
- [ ] ASC API key validity for `ascAppId 6759183746`.
- [ ] Demo / review account + reviewer notes prepared.
- [ ] IAP: `Clutch Picks Pro` entitlement + `$rc_monthly` package approved in ASC **and** mapped in RevenueCat.
- [ ] Live support URL + privacy-policy URL reachable.
- [ ] `release:check:production` run via Railway (I could not run it locally).
- [ ] Confirm the `2.11.0` engine is fully deployed and stale predictions recomputed (closes B2 at the source).

---

## Bottom line
Three blockers stand between here and GO, and all three are the **same defect family** — the tennis/cricket projection rework on this branch isn't finished: production serves illegal predictions (B1), it isn't on one engine version (B2), and the branch's own display tests are red (B3). Hand B1/B3 to `prediction-engine-doctor` (with `production-finisher` for the display/test reconciliation), redeploy a single coherent engine to clear B2, re-run `qa:predictions:production` until green and `bun test src` until clean, then re-gate. The rest of the app is submission-clean.
