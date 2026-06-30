# Clutch Picks — UI/UX Refinement Audit & Backlog

## Locked / frozen (DO NOT TOUCH)
- `src/components/sports/ArenaScoreboard.tsx` (scoreboard — frozen)
- `src/components/sports/TennisScoreGrid.tsx` (part of scoreboard family — treat as frozen)
- Fonts/typefaces, overall layout & IA, brand palette (MAROON `#8B0A1F`, TEAL `#7A9DB8`, BG `#040608`)

## Stack / styling idiom
- React Native + Expo SDK 53, NativeWind (className-first), Reanimated v3, gesture-handler, expo-haptics.
- Real token surface = `tailwind.config.js` (custom `fontSize` scale; default Tailwind 4pt spacing) + color constants in `src/lib/theme.ts`.
- `theme.ts` `SPACING`/`TYPOGRAPHY` JS objects are **unused (0 imports)** — the className scale is what renders. Do NOT try to force-migrate to JS tokens; work with the className grain.

## Key findings
1. **Inconsistent press feedback (highest impact).** Primary card tap-to-open uses only `active:opacity-85` (flat). Pick-selection uses a proper Reanimated scale 0.95→1 + Medium haptic. Different interactions feel like different apps.
2. **Ad hoc haptics.** 25 files call `Haptics.*` directly; no central semantic mapping. Pick selection uses `Medium` (too heavy for a selection per HIG).
3. **No radius scale.** 20+ distinct `borderRadius` values inline (1,2,3,4,5,6,8,10,12,13,14,15,16,17,18,20,22,24,28,999). Reads inconsistent.
4. **No motion tokens.** Durations/easings hand-entered (150/200/300/400ms; Easing.* and a few springs). No single motion scale.
5. **Numeric formatting** not centralized — stats app needs tabular figures + consistent precision/percent formatting (excluding frozen scoreboard).
6. Foundations already OK: Pressable everywhere (no legacy Touchable), 4pt spacing via Tailwind, color constants centralized.

## Prioritized backlog (highest perceived-quality impact first)
- **P1 — Semantic haptics helper** (`src/lib/haptics.ts`): `tap/selection/confirm/success/warning/error`, restraint, fire-and-forget. Migrate the most-used call sites.
- **P1 — Shared press-scale primitive** (`PressableScale`): Reanimated UI-thread scale + optional haptic, drop-in for primary tappables (cards, buttons, chips, rows). Apply to GameCard open, segmented controls, primary buttons — without changing layout.
- **P2 — Motion tokens** (`src/lib/motion.ts`): MOTION.fast/medium/slow durations + standard easing/spring configs; adopt in primitives.
- **P2 — Radius scale**: add a `borderRadius` scale to tailwind config + constants; normalize only clearly-accidental near-duplicate radii in shared components (conservative).
- **P3 — Numeric formatting** helper for tabular figures + precision on stats/percent (NOT scoreboard).
- **P3 — State polish**: skeletons/empty/error consistency on high-traffic screens (Home, picks, search).

## Verification
- Typecheck baseline before changes: ~12 known errors in `_layout.tsx`, `profile.tsx`, `edit-profile.tsx` (unrelated). Keep at baseline.
- Verify in motion on device; ship as OTA(s), bump `app-version.ts` revision.
