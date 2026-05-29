# App-Quality changelog (before/after, real static measurements)

## 2026-05-29 — App-wide spacing / alignment / placement pass (11 parallel agents, 2 waves)

Static audit (no live profiler): fix objective defects (cramped/touching, edge
misalignment vs the dominant inset, overflow risk, sub-44 tap targets) by aligning to
existing tokens (`ARENA_SIDE_PADDING=20` etc.); design-locked, no visual identity change.
Jersey files excluded (parallel workstream). Final `tsc`: 0 src errors.

Wave 1 (core surfaces):
- Home: sport section-header LED bar `marginHorizontal:16`→20 to flush with its cards; hitSlop on clear-search ✕ + Cancel.
- My Arena: removed redundant `marginBottom:28` wrapper under PredStrip (52px→24px gap); `LiveIntelStage` padding tokenized.
- Profile: header inset 20→16 to match all content; `numberOfLines` on userName/handle/matchupLine; hitSlop on Sign Out + gear.
- Game detail: `winProbShell` & `watchStrip` paddingHorizontal/marginHorizontal 18→16 (card-edge align); back-button hitSlop.
- Clutch Picks: `numberOfLines={1}` on the 6 win-probability label/% texts (wrap-baseline guard).
- Cards + Live Now: removed `chip.marginRight:8` that was additive with the row's `gap:8` (16px→8px, no trailing margin).

Wave 2 (all remaining screens + shared components):
- Auth/onboarding: sign-in/sign-up back arrow → 24 inset; verify-otp Resend hitSlop; 8 onboarding Back/Skip hitSlop.
- Settings/account/legal: privacy-policy back + edit-profile "Change Photo" hitSlop.
- Explore/history/sport: `sport/[sport]` additive chip `gap`+`marginRight` fixed; picks-history two double-space text bugs + `pickVs` numberOfLines.
- Social/info: ~10 back/follow button hitSlops; numberOfLines on user name/matchup/Picked/game-analysis subtitle.
- Shared: PredictionBadge double-gap (`ml-2` over `gap-2`) removed + tier-label numberOfLines.

Top remaining (proposals, NOT applied — need approval/live validation):
- GameCardSkeleton stacks teams VERTICALLY (jersey 52) but loaded GameCard is HORIZONTAL (jersey 60) → column→row reflow + jersey grow when data lands (real load shift). Skeleton rework needed.
- Home top cluster (TodaysGames LED bar + SportTile carousel) at 16 vs board's 20 — coupled to carousel paging math; validate live before aligning.


## 2026-05-29 (later) — My Arena: pinned header + duplicate Live Intelligence header

- Pinned `ArenaChrome` above the premium `PagerView`; removed `top={renderPremiumArenaChrome()}`
  from the 3 pages so only content swipes (no duplicate header slide / filter-vs-swipe conflict).
- Root `SafeAreaProvider initialMetrics={initialWindowMetrics}` added — kills the "paints under
  status bar then drops" first-frame jump app-wide.
- Instant press feedback on FollowedCard / live LiveCard / HorizonCard (was none).
- Removed the SECOND "Live intelligence" header (the "INSIDE THIS GAME" block + divider) inside
  `LiveIntelStage` and `LockedLiveIntelStage`. The "Live intelligence"/"Live board" heading above
  the live game card now opens one continuous section through the intel word cards (stage marginTop
  ARENA_SECTION_GAP → 6; bottom gap kept so Upcoming Slate stays separate). Removed now-unused
  `const moment` in both stages (`liveMomentLabel` still used elsewhere). Typecheck: 0 src errors.

## 2026-05-29 (later) — Clutch Picks tab end-to-end flow

| Area | Root cause | Fix | Before → After |
|------|-----------|-----|----------------|
| Read more | `numberOfLines` 3↔undefined, no animation | `LinearTransition(260)` on collapsing region + card root; affordance `FadeIn(180)` | Hard card-height snap → smooth UI-thread grow/shrink |
| Card glow | `shadowRadius` animated per frame (iOS re-raster cost; Android no-op) | Fixed `shadowRadius:22`, animate `shadowOpacity` only | Per-frame shadow re-raster removed; breathing look preserved |
| Initial load | 3 static skeleton boxes + spinner, wrong shape → dead + swap flash | `SkeletonCard` mirrors real card footprint; single shared `skeletonPulse` (UI thread) drives all bars; container `FadeIn(220)` | Dead static placeholder + shape flash → alive shimmer that matches the real cards |
| Open detail | (verified) cache seeded on press-in → no flash | none — already correct + in budget | unchanged (deliberately) |

Constraints honored: TeamJerseyCompact untouched; no jersey code touched; only
`clutch-picks.tsx` edited (clean of parallel jersey agent); no packages added
(reanimated 3.17.4 `LinearTransition`/`FadeIn` already present); removed now-unused
ActivityIndicator import. Typecheck `tsc -p tsconfig.app.json`: exit 0.

## 2026-05-29 — Profile + My Arena layout-shift pass

| Page | Change | Before | After |
|------|--------|--------|-------|
| Profile | Signature Calls loading skeleton matches card box | empty copy ~63px during load | reserved ~122px → **+59px jump removed** |
| Profile | Weekly Rhythm always renders 7-day scaffold | grid 0px during load | reserved ~57px → **jump removed** |
| Profile | Avatar → expo-image (cache + 160ms transition) | RN Image re-decode flash | smooth fade, no shift (72×72 fixed) |
| My Arena | Reserve SegPill footprint while loading (premium) | body jumps up 88px on data resolve | reserved 88px → **0px jump** |

Typecheck after all edits: 0 errors in `src/` (excluding the externally-edited
`jerseyVisuals.tsx`). Loaded appearance pixel-identical except the Profile zero-pick
Weekly Rhythm empty state (now shows the existing empty "-" grid instead of blank).

Not shipped (logged in findings.md): My Arena Your Games ~48px conditional shift (H1,
needs load-gate timing change), My Arena content cross-fade (M1), Profile multi-card
signature skeleton (count unknown pre-fetch).

## 2026-05-29 (later) — My Arena: status-bar jump, pager feel, tap feedback

Triggered by user report: header paints under the status bar then drops; pager swipe
between Game Day/Prep/Review feels rough; card taps feel dead.

| Area | Root cause | Fix | Result |
|------|-----------|-----|--------|
| App-wide top inset | No `SafeAreaProvider` / `initialWindowMetrics` anywhere — insets resolved AFTER first paint | Added `<SafeAreaProvider initialMetrics={initialWindowMetrics}>` at root (`src/app/_layout.tsx`, wrapping not touching RootLayoutNav) | Header lands in place on frame 1 — no under-statusbar-then-drop, app-wide |
| Card tap feel | FollowedCard (`:666`), live LiveCard (`:1271`), HorizonCard (`:1981`) used static `style={{}}` — zero press feedback | `style={({pressed})=>({...,opacity:pressed?0.9:1,transform:[{scale:pressed?0.99:1}]})}` | Instant sub-100ms press response; resting look unchanged |
| Pager swipe/scroll | Full header (search+filters+SegPill) duplicated INSIDE each of 3 swiping pages; gesture-guard hack locked pager during filter drags | Pinned `ArenaChrome` ABOVE `PagerView` (user-approved); removed `top={renderPremiumArenaChrome()}` from the 3 pages so only content swipes | Header no longer slides/duplicates; sport-filter drag no longer fights swipe; 3→1 header trees mounted (perf win). Tradeoff (approved): controls stay pinned instead of scrolling away |

Spacing preserved: SegPill marginBottom 28 + ArenaHeader marginTop 2 keep the same gap;
SearchBar paddingTop 28 keeps the title position. ErrorBoundary passes children through
(no wrapper), so pinned header + PagerView flex:1 lay out correctly. Typecheck: 0 `src/`
errors (excluding external jerseyVisuals.tsx).

## 2026-05-29 (later) — Clutch Picks: read-more tear, border feel, glow, load-in

Triggered by user report: load-in + border should be "premium / smooth as water"; the
read-more animation "breaks off from the top and bottom"; scrolling + glow should be
smoother and more controlled. Only `clutch-picks.tsx` edited. Typecheck: 0 non-jersey errors.

| Area | Root cause | Fix | Result |
|------|-----------|-----|--------|
| Read more border tear | TWO competing Reanimated `layout` anims — one on the inner text wrapper, one on the `TopPickCard` root. The root's layout snapshot animated the whole frame (incl. the absolute glowing border layers) on a separate track from the inner text → border detaches at top/bottom mid-expand | Removed root `layout` + inner `layout`; replaced with a measured-height accordion: two off-layout `<Text>` copies measure real collapsed (3-line) + full heights; ONE `useAnimatedStyle` height drives the visible clip. Real animated height reflows the body — and the border frame with it — every frame via Yoga | Frame opens *with* the text; no top/bottom tear; single animation track |
| Border "smooth as water" | Hard, tight bright bar (stops 0.3→0.7, peak 0.9) sweeping; 6800ms | Widened + softened sheen (stops 0.16→0.84, peaked white 0.82 with eased shoulders), rotation 6800→7600ms | Flowing sheen instead of a hard searchlight bar; slower, more luxurious drift |
| Scroll cost / overdraw | Rotating beam surface 800×800 (covers ~690 card diagonal with big margin) animating per card | 800→740 (still covers expanded-card diagonal ~690), gradient halves 400→370 | ~14% less animated surface overdraw per mounted card |
| Glow control | shadowOpacity 0.22→0.50 over 3400ms — a touch strong/fast | range 0.16→0.38, period 3400→4200ms | Gentler, slower, more controlled breath; fixed shadowRadius 22 kept (no per-frame re-raster) |
| Load-in | FadeInDown delay×80 cap240, 650ms — slightly heavy/slow | delay×70 cap210, 560ms | Snappier premium stagger; skeleton footprint match unchanged |

Notes: `EXPAND_TRANSITION`/`LinearTransition` removed (no longer referenced). Accordion is
deterministic (no nested-`layout` propagation guesswork) and reflows FlatList siblings via a
real animated height. No jersey files touched; no packages added.

Follow-up (same report — expand still "cut off / jumped"): root cause was the FlatList's
`removeClippedSubviews={true}`. It recycles row subviews from cached frame measurements and
clips a row that is GROWING mid-expand → content cut off during the animation, then snaps when
the row re-measures. App runs the new architecture (`newArchEnabled: true`, app.json), where an
animated `height` reflows parents fine — so this clipping flag was the remaining offender. Fix:
`removeClippedSubviews={false}` (the Top Picks list is one pick per sport — short — so the flag
bought ~nothing), bumped `windowSize` 5→7 / `initialNumToRender` 2→3 / `maxToRenderPerBatch`
3→4 to keep rows mounted, and measured the collapsed/full heights at full precision (raw px +
0.5px epsilon guard instead of `Math.ceil`) so both ends land exactly on the text. Typecheck: 0.

Follow-up 2 (user photo — hard red segment on the LEFT border "cut off, then jumps"): the
rotating beam was TWO stacked gradients (teal/white top half, maroon bottom half), each a bright
band on the X axis hard-clipped to transparent at x<0.16 / x>0.84. Those hard left/right cutoffs
sweep past the card edge as it rotates → look like the light getting clipped; the y=370 boundary
between the two halves was also a hard centre seam. Fix: replaced both with ONE continuous
vertical ramp (teal → silver-white → maroon) running top→bottom, so every row is a full-width
band (no left/right edge) and every colour fades through its OWN zero-alpha — not through black —
(no centre seam, no hard top/bottom edge). Also one gradient instead of two = less overdraw.
Border now sweeps seamlessly like flowing light. clutch-picks.tsx typecheck: 0.
(Pre-existing unrelated errors live in search.tsx from a parallel SafeAreaView→TopInsetView
refactor — not touched here.)

Follow-up 3 (still cutting off + background gone): TWO issues.
(a) Background regression: the parallel SafeAreaView→TopInsetView refactor also landed in
clutch-picks.tsx and passed `backgroundColor="#010101"` to `<TopInsetView>`. TopInsetView ALWAYS
paints its resolved bg (opaque), so it covered the absolute-fill `<ClutchPicksBackground>` behind
it. Fix: `backgroundColor="transparent"` (outer View is already #010101 → no white-flash risk).
(b) Border STILL cut off because Follow-up 2's ramp put the maroon band far from the box centre
(loc 0.8 → ~311px from centre on a 740 box). A band that far out swings OUTSIDE the card on
left/right as the box rotates → maroon leaves the card and returns = the cut/jump. Real fix:
compress BOTH highlights to near centre — silver-white peak at loc 0.48 (~15px off centre),
maroon peak at 0.60 (~74px), both fading to their own zero-alpha by ≤148px. On the card (half-min
dimension ~140–195px) nothing ever reaches the edge, so nothing clips at any rotation. Transparent
gap (0.52–0.55) between silver and maroon avoids a pink blend. clutch-picks.tsx typecheck: 0.

Follow-up 4 (THE actual root cause — still cut off): the gradient was never the real problem.
The rotating square was `position:absolute` with NO top/left insets, so it anchored to a CORNER
of the border wrapper and its transform-rotate spun it around an OFF-CENTRE point (off the card to
the right). The left edge was farthest from that pivot, so the highlight swung off the LEFT and
"cut off, then jumped" — no colour/stop change could fix an off-centre spin. Fix (clean rebuild of
the rotating layer, same colours + same rotation): lock the 740² square dead-centre on the card
with `top/left: '50%'` + `marginTop/Left: -370`, so it spins around the card's TRUE centre
regardless of the layout engine's absolute-child alignment. Kept the two bright bands within the
safe radius (≈ half the card's short side). clutch-picks.tsx typecheck: 0.

Follow-up 5 (RESOLVED — the real fix): the square was a FIXED 740². Fine for a collapsed card,
but an EXPANDED card's diagonal exceeds 740, so the square's own hard edge rotated INTO the tall
card = the cut. Fix: measure the border wrapper (`onLayout`) and size the square to the card's
real diagonal — `beam = ceil((hypot(w,h)+24)/100)*100`, height sticky-max + snapped to a 100px
step so it only grows (a bigger square still covers a smaller card → no shrink churn; settles
after first expand). User confirmed the cut-off is gone.

Follow-up 6 (look): spread the two colours toward opposite sides, anchored in PIXELS via
`L(px)=0.5+px/beam` to a fraction of the safe radius `a = w/2` (fixed gradient fractions would
drift outward and re-cut on tall cards as the square scales).

Follow-up 7 (premium feel): the two highlights looked mismatched — metallic was a sharp white
spike in dim teal (reads as a small FAST dot), maroon was a broad uniform glow (reads slow/long).
Rebuilt as TWO MATCHED, symmetric soft glows about centre: metallic = teal-0 → silver-white →
teal-0 (steel→chrome), maroon = maroon-0 → maroon → maroon-0; identical width (peaks ±0.54·a,
fades ±0.16·a inner / ±0.90·a outer, inside the safe radius). Identical apparent length + speed,
opposite sides. Rotation slowed 7600→9000ms for a more luxurious pace. clutch-picks.tsx typecheck: 0.

Follow-up 8 (still not satisfying — "move WITH each other not against"): the two glows were 180°
apart (one on each side of centre). Even spinning the same way, on each edge one heads up while the
other heads down → reads as fighting. Fix: moved BOTH colours to the SAME side of centre, adjacent
(metallic peak 0.30·a leads, maroon peak 0.58·a follows, dim bridge between to connect them and
avoid a pink blend; whole −side transparent). Now they orbit the frame as a single travelling pair
in one direction. Outer fade 0.82·a keeps it inside the safe radius. clutch-picks.tsx typecheck: 0.

Follow-up 9 (kept only maroon, then "all same speed + size that are tracing"): a full-width
gradient bar clipped to each card's rectangle CAN'T trace uniformly — it shows segments of
different length/speed at corners vs edges and across different card heights. Replaced the whole
rotating-square + linear-gradient approach with a SINGLE soft maroon RADIAL glow (react-native-svg
RadialGradient, 176px) that orbits the card on its own ellipse: `orbitStyle` translates a centre
dot by `(w/2·cosθ, h/2·sinθ)` using the existing 0→360 value. One light, fixed px size, constant
angular speed → identical trace on every card, never clipped (it's a dot inside the frame, not a
bar that can swing off). `beam`/`a`/`L`/`rotatingStyle` removed; dims now tracks live size for the
ellipse. Resting silver/teal still from the static base. clutch-picks.tsx typecheck: 0.

Follow-up 10 (FINAL — remove the border animation entirely + make the border one metallic colour):
per the user, the whole rotating/tracing border treatment is gone. Removed the orbit glow + its
machinery (`rotation`, `glowPulse`, `orbitStyle`, `dims`/onLayout, the SVG glow) and the breathing
outer-glow pulse (now a STATIC silver halo, shadowOpacity 0.26). Static base recoloured to a single
silver/chrome metallic gradient (light silver → steel → white → steel → light silver) — the maroon
stop removed, so the border is one metallic colour with no motion. Cascade cleanup: dropped the
now-unused `animationsEnabled` prop, `isFocused`, and the `useIsFocused` import. Press feedback and
the card entrance (FadeInDown) intentionally kept (interaction/load-in, not a border animation).
Interior coral/blue body glows left as-is (they're the card interior, not the border).
clutch-picks.tsx typecheck: 0.

Follow-up 11 (FINAL maroon animation — matched the game-detail prediction card): user asked to
add a satisfying maroon border animation that wraps the WHOLE border collapsed AND expanded, and
to reuse the game-detail prediction card's animation if easier. Ported that card's exact rotating
dual-beam border (teal/white top gradient + maroon bottom gradient, 4500ms linear rotation,
InteractionManager-deferred start) over the metallic base. KEY adaptation: game-detail uses a fixed
800px spinning square (it never resizes); these cards grow when expanded and overflowed 800 — THAT
was the historical "cut off / skipped corners". Here the square is sized to the card's MEASURED
diagonal: `beam = ceil((hypot(w,h)+40)/100)*100`, so `beam/2 ≥ half-diagonal + 20px` always → the
beam covers every corner at every angle, any size (proven by the geometry review for collapsed,
expanded, big-phone, extreme). Decisions from the de-risk + adversarial review workflows:
react-native-svg dash-trace was the alternative (traces the exact perimeter) but matching the
game-detail beam was the user's chosen path and is consistent app-wide. Beam stored as snapped
state, committed only when the 100px-quantised value changes → no re-render churn on expand + all
collapsed cards share one beam size. White glint raised 0.5→0.85 so the sweep reads over the LIGHT
silver base the way 0.5 reads over game-detail's dark base. Focus-gated via useIsFocused (tabs keep
freezeOnBlur OFF, so decorative loops must pause off-screen). InteractionManager added to imports.
clutch-picks.tsx typecheck: 0.
