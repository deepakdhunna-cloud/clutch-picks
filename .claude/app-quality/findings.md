# App-Quality findings ledger

Standing task: buttery animations/selection/section loads + ZERO layout shift.
Measurements here are STATIC and real (rendered px from style code; render scope;
animation thread). No live FPS profiler is available in this environment, so no
FPS/dropped-frame numbers are recorded — that would be fabricated data.

## Run — 2026-05-29 — Profile + My Arena (priority pages)

### Profile (`src/app/(tabs)/profile.tsx`)
- [FIXED] HIGH — Signature Calls collapse→pop. Empty copy ~63px → first card ~122px
  = **+59px** below-fold jump while `picks`/`allGames` load. Fix: `SignatureCallSkeleton`
  (memo) mirrors one loaded card's exact box; shown only while `dataLoading` and no calls.
- [FIXED] HIGH — Weekly Rhythm grid collapse→pop. Grid 0px during load → ~43px + ~14px
  labels = **~+57px** jump. Fix: removed `if (displayPicks.length===0) return []` so the
  7-day scaffold always renders (height stable; cell content fills in). NOTE: a brand-new
  zero-pick user now sees the empty "-" grid (identical to the existing "no picks this
  week" look) instead of a blank — minor empty-state change, accepted for the stability win.
- [FIXED] LOW — Avatar re-decode flash on tab refocus (no shift; 72×72 fixed). Fix:
  `expo-image` (~2.4.1, already installed) with `memory-disk` cache + 160ms transition.
- Verified NON-issues (left untouched): VERIFIED ANALYST badge, Accuracy block, Recent
  Picks row (fixed height:146), Achievements (always 4), Form line (10 fixed bars). All
  subcomponents memo'd, derived data in useMemo, handlers useCallback, animations are
  Reanimated FadeInDown (UI thread), scroll handler is a worklet @ throttle 16.
- REMAINING: multi-card Signature Calls still grows past the 1-card skeleton (count
  unknown pre-fetch). Low impact.

### My Arena (`src/app/(tabs)/search.tsx`)
- [FIXED] CRITICAL — SegPill pops in → whole arena body jumps up **88px** (premium only;
  58 inner + 2 border + 28 ARENA_SECTION_GAP). Fix: `SEG_PILL_RESERVED_HEIGHT` constant;
  loading branch renders an inert 88px spacer for premium (`search.tsx:3041`); SegPill
  inner `minHeight` now references the same constant (value-identical 58).
- [NOT FIXED] HIGH (H1) — Your Games empty CTA (minHeight 118) → populated FollowedCard
  list (minHeight 162) = **~+44–48px** downward shift when stored follows (`fgi` from
  AsyncStorage) resolve AFTER `contentReady` flips. Proper fix = hydrate `fgi` before the
  content gate (touches the loading gate in `useFocusEffect` ~2957–2968). Left for explicit
  go-ahead — risky on a 3,114-line screen with paying users. Forcing the empty CTA to the
  populated height was rejected (dead space for the no-follows majority).
- [NOT FIXED] MEDIUM (M1) — skeleton→content is a hard swap (no cross-fade). No surrounding
  pixel jump now that chrome is stable. Optional opacity-only FadeIn on the content region
  (NOT the PagerView root) if desired later.
- Verified clean: redesigned LiveCard is height-stable across score updates (jersey 78,
  name minHeight 32, fixed-size scoreboard SVG, tiles minHeight 58); both FlatLists have
  stable keyExtractor + getItemLayout; `useGames` uses keepPreviousData + mergeGameLists so
  cache→fresh never reorders/resizes; all animations UI-thread worklets with cancelAnimation.

## Run — 2026-05-29 — Clutch Picks tab end-to-end flow (load → cards → read more → open detail)

Scope: `src/app/(tabs)/clutch-picks.tsx` only (clean of the parallel jersey workstream).
`TeamJerseyCompact` left untouched. No live FPS profiler in this env — costs reasoned
from render scope + animated property type + surface size (static, real, not fabricated).

### Read more / Show less (`ExpandableText`) — was the #1 jank
- [FIXED] HIGH — tap flipped `numberOfLines` 3↔undefined with ZERO animation → hard,
  instant card-height snap inside the FlatList (whole row + everything below jumps).
  Fix: wrap collapsing region in `Animated.View layout={LinearTransition(260ms, easeOutCubic)}`
  AND add the same `layout` to the card root `Animated.View` so the FlatList row grows/shrinks
  smoothly. Affordance now `Animated.Text` keyed on expanded with `FadeIn(180)`. Height interp
  is UI-thread (no JS per frame). List data is stable (top picks don't reorder on expand), so
  `layout` on the item root is safe — no virtualization fight.

### Card continuous animations (`TopPickCard`)
- [FIXED] MEDIUM — `glowStyle` animated `shadowRadius` 14→30 every frame: re-rasterizes the
  iOS shadow per frame on a list of heavy cards (real cost), and is a pure no-op on Android
  (elevation drives Android shadows; elevation wasn't animated). Fix: fixed `shadowRadius:22`
  (old range midpoint), animate `shadowOpacity` only (cheap composite property). Breathing look
  preserved. Opacity range nudged 0.24/0.48 → 0.22/0.5 to keep perceived range with fixed radius.
- [KEPT — premium identity] 800×800 rotating dual-gradient border per card. It IS the premium
  look and IS correctly gated on `isFocused` (cancelAnimation on blur). Rotation transform is a
  cheap UI-thread op; the cost is GPU overdraw of the 800² surface ×N mounted cards. NOT touched
  — killing/shrinking it would change UX intent for an unproven win without a live GPU profiler.
  FLAGGED for a future measured pass (Android device, Perf Monitor) if scroll FPS dips.

### Load (initial skeleton)
- [FIXED] MEDIUM — skeleton was 3 STATIC boxes + 1 ActivityIndicator, shaped nothing like the
  real card → felt dead + shape/size flash on hard-swap to the FadeInDown FlatList. Fix:
  `SkeletonCard` mirrors the real TopPickCard footprint (maroon rank badge, 2 stacked team rows,
  strength/prob block, 3 analysis lines on lead card); a SINGLE shared value (`skeletonPulse`,
  900ms repeat, gated on isInitialPicksLoading, cancelled otherwise) drives every bar's opacity
  on the UI thread (no per-bar animation). Skeleton container wrapped in `FadeIn(220)`.

### Open game detail (`handleGamePress` → `/game/[id]`)
- [VERIFIED CLEAN — NOT touched] On press-in `seedGameDetailCache` synchronously writes the source
  game into `['game', gameId]` (useGames.ts:79). Detail mounts → `useGame` returns cached game →
  `isLoading && !game` is false → `GameDetailLoading` skipped → paints from cache frame 1, no white
  flash. Transition `ios_from_right` 200ms via dedicated Stack.Screen. Already correct + in budget;
  editing it would only risk colliding with the parallel jersey workstream for zero gain.

## Cross-cutting (verified, do NOT regress)
- `enableScreens(true)` is on. `freezeOnBlur` is DELIBERATELY OFF on the `(tabs)` navigator
  (`src/app/_layout.tsx:200`) — a code comment documents it crashed natively with reanimated
  in GlassBottomNav. DO NOT re-enable it.
- Stability helpers all present and applied: home-games-cache, home-games-first-paint,
  home-games-request-plan, game-cache-merge, game-detail-load-stability.

## Run — 2026-05-29 — Animation & Reanimated cost sweep (READ-ONLY audit)

Lens: continuous (withRepeat) loops on list items / unfocused screens; layout-prop
animations (shadowRadius/height) vs transform/opacity; JS-thread Animated; missing
cancelAnimation; large rotating SVG/LinearGradient surfaces; per-card animation count.
No live FPS profiler in env — costs reasoned from animated-property type + render scope
+ surface size + loop count (static, real). Nothing edited.

### NEW findings
- [OPEN] HIGH — `GameCardSkeleton.tsx:23-35` — `SkeletonRect` runs a SEPARATE `withRepeat`
  pulse PER rect. 9 rects/card × 4 cards (`GameCardSkeletonList`) = up to 36 independent
  UI-thread loops during every Home/list load. `useEffect` deps `[]` and NO `cancelAnimation`
  cleanup. Fix: one shared pulse value driving all rects (the clutch-picks SkeletonCard pattern).
- [OPEN] HIGH — `game/[id].tsx:1031-1073` `ConfidenceBarSegment` — up to 10 simultaneous
  `withRepeat(rotate 360)` loops, each spinning a 60×60 LinearGradient, one per filled segment,
  on the game-detail PICK STRENGTH bar. Deferred via InteractionManager (good) but all 10 run
  forever while the screen is mounted (and game/[id] is freezeOnBlur:false → keeps running when
  navigated away). Fix: one shared rotation value shared by all segments (or a single masked sweep).
- [OPEN] MEDIUM — `game/[id].tsx:1131-1134` `glowStyle` animates `shadowRadius` (8→20) per frame —
  the exact per-frame iOS shadow re-raster the team already removed in clutch-picks (changelog).
  Android no-op (elevation not animated). Fix: fix shadowRadius, animate shadowOpacity only.
- [OPEN] MEDIUM — `onboarding.tsx` — ZERO `cancelAnimation` in the whole file. PulsingDot (66-68),
  glow/grid loops (161-164), particle translateX drift (111-113) + its `setInterval` re-fire (126-128),
  glowPulse (363) all withRepeat with empty-deps useEffect and NO unmount cleanup. Onboarding DOES
  unmount → leaked running loops + per-frame shadowRadius (367-368). One-time screen → lower impact.
- [OPEN] LOW — `paywall.tsx:201-202` per-frame `shadowRadius` animation (transient modal screen).
- [OPEN] LOW — `LiveArenaCard.tsx` + `search.tsx` `SoftGlow`: 3 SVG 11-stop RadialGradient surfaces
  per live card, all sharing ONE hardcoded def id ("liveSoftGlow"/"liveCardSoftGlow"). Static (no
  per-frame work) so not an FPS-per-frame cost, but heavy rasterize ×N cards + fragile shared id.
  Home "View All" live rail is a NON-virtualized ScrollView (`index.tsx:591-602`) → all live cards
  mount at once, each with a LiveDot withRepeat + 3 SVGs. Watch on a long live slate.
- [OPEN] LOW — `CompactLiveCard.tsx:20` is NOT memoized (plain fn). Inner LiveArenaCard is memo+deepEqual
  so it bails, but the wrapper re-runs on every Home re-render (live throttle 200ms, filter changes).

### Verified CLEAN (animation lens)
- `useLiveScores.ts` — throttled 200ms, AppState-aware (disconnect on background), deep-equal merges
  return same ref when unchanged → no render storm. Data layer is NOT the anim problem.
- `GameCard.tsx` — no withRepeat; only interaction-driven scale/selection worklets (transform/opacity).
- `AnimatedSplash.tsx` — one-shot entrance, transform/opacity, cleaned up.
- `PickConfirmationModal.tsx` — withRepeat loops cancelled on close + unmount; transient.
- `SportCard PixelGrid / DotMatrix` (the Jumbotron LED look) — memo'd, STATIC SVG, no withRepeat. The
  flagged "pixel grid / scanline / flicker" loops do NOT exist as continuous anims here.
- `ClutchPicksBackground.tsx` — static SVG, no animation.
- `live-games.tsx LivePulse` / `LiveArenaCard LiveDot` / `[id] LivePulseDot` / `colonOpacity` /
  `search.tsx LiveDot` — all transform/opacity worklets, single shared value, cancelAnimation on unmount.
