# Clutch Picks — Master Layout & Typography Audit

> Phase 0 + read-only recon. Run 2026-05-29. NO fixes applied this run.
> Ranking: Critical > High > Medium > Polish. Grouped by phase.
> All paths absolute. file:line are examples, not exhaustive.

## Magnitude at a glance
- Inline numeric spacing props: **1,924** — 48% (914) off the 4pt grid.
- Inline `fontSize`: **889**, spanning ~every integer 6→72.
- Inline `letterSpacing`: **42 distinct values**.
- Two conflicting type scales (theme.ts vs tailwind.config.js).
- theme.ts SPACING/TYPOGRAPHY tokens: **never imported** (dead).

---

## PHASE 1 — Character-level defects in formatters/helpers

Target set (the source-of-truth string helpers):
- /Users/deepakdhunna/clutch-picks/src/lib/display-confidence.ts
- /Users/deepakdhunna/clutch-picks/src/lib/prediction-display.ts
- /Users/deepakdhunna/clutch-picks/src/lib/projection-display.ts
- /Users/deepakdhunna/clutch-picks/src/lib/narrative-display.ts
- /Users/deepakdhunna/clutch-picks/src/lib/stored-pregame-display.ts
- /Users/deepakdhunna/clutch-picks/src/lib/decision-profile-display.ts
- /Users/deepakdhunna/clutch-picks/src/lib/model-calibration-display.ts
- /Users/deepakdhunna/clutch-picks/src/lib/pick-resolution-display.ts
- /Users/deepakdhunna/clutch-picks/src/lib/tonight-narrative.ts
- /Users/deepakdhunna/clutch-picks/src/lib/signature-calls.ts
- /Users/deepakdhunna/clutch-picks/src/lib/cricket-score.ts
- /Users/deepakdhunna/clutch-picks/src/lib/game-start-label.ts

### HIGH
1. **Tier-range glyph drift (same data, two glyphs).** Hyphen vs en-dash for the
   identical confidence ranges.
   - hyphen: display-confidence.ts (CONFIDENCE_TIER_DEFINITIONS, "53-59%", "60-66%",
     "67-74%"); confidence-explained.tsx:26-28 ("37-42%", "43-49%", "50-57%").
     [display-confidence.ts is the source; tier ranges live ~lines 96/103/110]
   - en-dash: onboarding.tsx:483-485 ("53–59%", "60–66%", "67–74%").
   Fix at the formatter source so every screen reads one glyph.
   ✅ RESOLVED 2026-05-29 (Phase 1, Batch 1): display-confidence.ts:96/103/110 →
   en-dash `–`. Source now matches the already-correct onboarding screen; all tier
   consumers inherit it. The three-way ranges in confidence-explained.tsx:26-28
   ("37-42%" etc.) live in a SCREEN → carried to PHASE 3.

2. **"Toss-Up" casing drift in user-facing text.**
   - Canonical `Toss-Up`: prediction-display.ts:119-122 (label/badge/leanLabel).
   - Variant `Toss-up`: search-explore.tsx:953 & :960; onboarding.tsx:774.
     (onboarding.tsx:482 itself says "Toss-Up" — inconsistent within one file.)

3. **"No Pick" casing drift.** `No Pick` (prediction-display.ts:85-87) vs `No pick`
   (3 user-facing sites). Enforce Title Case from the formatter.

### MEDIUM
4. **Ellipsis style: literal `...` vs glyph `…`.** Loading/placeholder copy uses
   literal three dots widely:
   - settings.tsx:492 "Signing Out...", :540 "Redeeming..."
   - game-analysis.tsx:265 "Loading analysis..."
   - verify-otp.tsx:256 "Sending...", paywall.tsx:665 "Loading..."
   - onboarding.tsx:915 "Your name...", index.tsx:1584 "Search teams, sports..."
   - search.tsx:1942 manual truncation `body.substring(0,140) + '...'`
   Only live-games.tsx, search.tsx, MLBLiveState.tsx use `…`. Pick one (proposal: `…`).

5. **Spaced-hyphen separator in narrative text.** stored-pregame-display.ts:509
   ("`${factors.length} factors - ${edgeCount} edges identified`") and :513
   ("`Pregame snapshot - ${...}% lean`") use ` - ` while the app's separator is
   `·`/`—`. Normalize. (cricket-score.ts ` - ` is a score line — leave.)
   ✅ RESOLVED 2026-05-29 (Phase 1, Batch 1): both → middot ` · ` (compact-meta
   canon, since both surface as the analysis-link subtitle). cricket-score.ts:63/65
   confirmed score lines — LEFT. Lockstep test assertion updated (test:191).

6. **Mixed apostrophe glyphs.** narrative-display.ts:7 regex contains a CURLY `’`
   inside `don['’]t sleep` mixed with straight `'` — only a regex (no user impact)
   but signals inconsistent quote convention; user-facing copy elsewhere uses
   straight `'` (signature-calls.ts). Decide one convention app-wide.

7. **"View All" vs "View all" CTA casing.** 3× Title Case vs 1× sentence case.

### POLISH
8. **Lowercase status labels** in model-calibration-display.ts ("no data",
   "calibrated", "watching", "needs tuning") vs sentence-case headlines in
   decision-profile-display.ts ("Hidden edge", "Upset watch"). Likely intentional
   (badge vs headline) — VERIFY rather than blanket-fix.
9. **getConfidenceTier return alignment** display-confidence.ts:162-165 has
   whitespace-padded `return` columns (code cosmetics, NOT user text) — out of lane,
   noted only.

### CLEAN (leave alone)
- No double-spaces inside string literals (0 found).
- No mojibake / replacement chars (0 found).
- No space-before-punctuation in real copy (all hits were ternary code).
- signature-calls.ts: consistent straight quotes + consistent em-dash. Clean.

---

## PHASE 2 — Off-scale spacing app-wide (bypassing tokens)

914 of 1,924 inline spacing values are off a 4pt grid; the dead SPACING token means
nothing is enforced. Worst-offender files (inline numeric spacing prop count):

| Count | File |
|---|---|
| 266 | /Users/deepakdhunna/clutch-picks/src/app/(tabs)/search.tsx |
| 249 | /Users/deepakdhunna/clutch-picks/src/app/game/[id].tsx |
| 208 | /Users/deepakdhunna/clutch-picks/src/app/onboarding.tsx |
| 116 | /Users/deepakdhunna/clutch-picks/src/app/(tabs)/index.tsx |
| 114 | /Users/deepakdhunna/clutch-picks/src/app/(tabs)/profile.tsx |
| 106 | /Users/deepakdhunna/clutch-picks/src/app/search-explore.tsx |
| 104 | /Users/deepakdhunna/clutch-picks/src/components/sports/GameCard.tsx |
| 102 | /Users/deepakdhunna/clutch-picks/src/app/game-analysis.tsx |
|  98 | /Users/deepakdhunna/clutch-picks/src/app/(tabs)/clutch-picks.tsx |
|  63 | /Users/deepakdhunna/clutch-picks/src/app/user/[id].tsx |

Off-scale value families to migrate (counts across app): 10(160), 14(129), 6(123),
5(86), 3(69), 7(44), 18(39), 9(32), 11(25), 13(16), 22(12), 15(6), 17(3).

CRITICAL prereq: do NOT migrate until 6a/6b/6c in tokens.md are signed off. Migrating
to an un-blessed scale = churn.

---

## PHASE 3 — Per-surface spacing / alignment / wrapping

Surfaces = all of src/app/*.tsx + src/components/sports/*.tsx (full list in report C).

### CRITICAL
10. **Screen-edge margin is not consistent app-wide.** Outer horizontal padding
    varies by screen: edit-profile=20, privacy-policy=20, verify-otp=24, sign-in=16/24,
    [sport]=16/20, model-accuracy=10/20. The worst is game/[id].tsx with 17 distinct
    horizontal-padding values (0,2,4,6,7,8,9,10,11,12,13,14,15,16,20,22,28) and
    search.tsx with 14. GlassBottomNav.SPEC.md declares the island edge = 20px.
    -> Pick ONE canonical screen edge (proposal: 20) and reconcile. Highest leverage.

### HIGH
11. **game/[id].tsx + (tabs)/search.tsx are the chaos epicenters** — both combine the
    most off-scale spacing AND the most edge-margin variance. These two screens alone
    likely account for the strongest "cramped/chaotic" feel. Tackle first in Phase 3.
12. **onboarding.tsx** mixes 11 horizontal-padding values and houses several of the
    Phase-1 text defects (Toss-up casing, en-dash ranges) — concentrated cleanup win.

### MEDIUM
13. **Truncation relies on RN defaults.** 149 `numberOfLines` guards but ZERO
    `ellipsizeMode` declarations app-wide. Long team names truncate via default `tail`
    ellipsis (acceptable) — but a few long-name spots need an on-device eye (see
    judgment calls). GameCard.tsx has 50 <Text> / 12 guarded — verify team-name nodes
    are guarded.
    🔶 PARTIAL 2026-05-29 (Phase 3, Batch 3): the NAME-render subset of this item swept
    app-wide. 6 tiny-shrink/clip-risk name sites converted to clean 2-line wrap
    (game/[id]:1785/1789, GameCard:487/540, picks-history:139, profile:288, user/[id]:74,
    game-analysis:430). Already-correct sites confirmed (GameCard:1057/1120,
    PickConfirmationModal:290, MLBLiveState:362, search-explore:192/215/409). 3 sites
    flagged as JUDGMENT CALLS (fixed-height / compact / abbreviation): search-explore:291/
    312 (fixed h=98 row), profile:525/526 (124×140 tile, abbrev), confidence-explained:138
    (abbrev via params). See changelog Phase 3 Batch 3. `ellipsizeMode` still undeclared
    app-wide (default tail) — left for a later pass.

### POLISH
14. Numeric column alignment (stat rows, projected score lines) — verify decimal/right
    alignment is consistent (projection-display.ts already pads decimals consistently;
    confirm the rendering side aligns columns). Needs on-device check.

---

## Judgment calls flagged for Deepak's on-device eye (do NOT auto-decide)
- J1: Canonical screen edge = 16 vs 20 vs 24? (proposal 20, matches nav). HIGH impact.
- J2: Ellipsis `…` vs literal `...` — confirm `…` renders cleanly in the app font on
  buttons/placeholders before global swap.
- J3: Range separator en-dash `–` vs hyphen `-` — confirm en-dash renders in the
  number font/badges.
- J4: Long team/player name truncation points (e.g. NCAAB full school names on
  GameCard / game detail) — needs visual confirmation of where to clamp.
  🔶 Phase 3 Batch 3: 6 main name renders converted to 2-line wrap (no clamp/abbrev).
  Still need on-device wrap-point confirmation at: game/[id]:1783-1791 (doubles names),
  GameCard:487/540 (live rows vs score), profile:288, user/[id]:74. THREE constrained
  sites NOT fixed and need Deepak's decision (fixed-height / compact tile / params):
  search-explore:291/312, profile:525/526, confidence-explained:138.
- J5: model-calibration lowercase badges ("calibrated") — intentional badge style or
  drift? Confirm before changing.
- J6: Snap targets for ambiguous off-scale values (13→12 or 14? 18→16 or 20?) — many
  are case-by-case optical calls, not pure math.

---

## Next target after sign-off
Phase 1 (formatter character-level fixes) — lowest risk, fixes propagate everywhere
from the source helpers. Then J1 (canonical edge) as the keystone for Phase 2/3.
