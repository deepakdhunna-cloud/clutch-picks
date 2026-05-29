# Jersey Artist Changelog

## Run 8 — 2026-05-29 — CARRY BOLD BROADCAST GRAPHIC THROUGH THE WHOLE GARMENT + CONTRAST-GUARD ANTI-OVER-SNAP

### Context / directive
Run 7 overhauled the NAME/NUMBER to the bold broadcast-graphic look (keyline +
crisp full-opacity twill + pure fill + 3.4 contrast guard). Run 8 carries the same
treatment through the REST of the jersey (body already saturated in run 7; this run
is BODY/TRIM/PANELS) so the whole garment reads as one confident broadcast graphic,
and closes the contrast-guard over-snap gap flagged as run 7's next target. Finish/
color/contrast only — silhouettes, placement, construction geometry from runs 1-7
unchanged. No git, no deps, no runtime filters, no per-frame work.

### AUDIT (harsh, bold-graphic consistency, sport by sport)
The systemic laggard: while run-7 lettering snaps with PURE full-opacity color, EVERY
collar/cuff/panel/stripe/placket/sash/yoke/crest was still drawn SEMI-TRANSPARENT
(fillOpacity 0.24-0.76) over the body gradient — so the team's vibrant secondary was
optically MIXED with the body underneath and read washed/muddy next to the punchy
text. Worst offenders: **football** yoke band 0.34 + cuffs 0.46 (signature pads read
as a tinted ghost); **hockey** hem/crest/cuff set 0.34-0.76 (defining trim veiled);
**cricket** sash 0.34 (nearly invisible); **basketball** side panels 0.46-0.5 (read
as a body tint, not a cut-and-sewn panel); **tennis/soccer/ucl** cuffs 0.34 + hems
0.52-0.54; **baseball** closest but still 0.5-0.72.

### FIX 1 — near-solid confident trim across all 9 (0 nodes)
Lifted the fillOpacity/strokeOpacity of the MAJOR trim surfaces to near-solid so the
secondary reads as a confident broadcast accent, while the fold-highlight / AO /
seam-stitch shading (which sits ON TOP) was left untouched so dimension is preserved:
- **Football:** yoke band 0.34->0.82, cuffs 0.46->0.92, sleeve-end rect 0.36->0.82.
- **Baseball:** collar 0.72->0.9, front piping 0.92->1, sleeve piping 0.58->0.82,
  hem arc 0.5->0.78, sleeve patch rects 0.36/0.48->0.62/0.82.
- **Hockey:** chest yoke 0.24->0.5, hem band 0.76->0.95, lower hem 0.66->0.9, cuff
  bands 0.58->0.92, accent center stripes 0.34->0.62, crest oval 0.66->0.9 + crisper
  accent ring.
- **Cricket:** collar V 0.72->0.9, shoulder flashes 0.42->0.82, hem arc 0.62->0.82,
  collar accent 0.38->0.52, DIAGONAL SASH 0.34->0.78.
- **Tennis:** cuffs 0.34->0.78, placket 0.5->0.8, hem 0.52->0.82.
- **Soccer/UCL:** cuffs 0.34->0.78, double hem 0.54->0.82.
- **Basketball:** SIDE PANELS 0.46/0.5->0.88/0.92 (now distinct textiles), hem trim
  lines 0.36/0.44->0.72/0.78, hem accent 0.18->0.36.
- **Shared crest (LegalSafeCrest, soccer/cricket/tennis/default):** all 3 shapes
  0.76-0.78->0.9 + crisper accent rings.
- **Trim gradient ramp (both ModelDefs + basketball inline):** now that fills are
  near-solid, shallower dark falloff (darken 0.26->0.2 / 0.24->0.18, secondary owns
  more of the band 0.5->0.55) so a bold cuff/panel stays VIVID at both ends instead
  of fading to a muddy dark — same Stop count, 0 nodes.

### FIX 2 — contrast-guard anti-over-snap + a real legibility bug fix (0 nodes)
The run-7 guard could OVER-snap to a flat white even when the team's vivid secondary
(or a punchier tint of it) would read better and stay on-brand. Run 8 ranks the
candidate set BRAND-FIRST: true secondary/accent, then progressively stronger tints
of the SAME color (lighten/darken 0.34, then 0.55), and only THEN the neutral
white/near-black safety nets. The guard returns the richest BRAND candidate that
clears 3.4:1 before ever falling back to a neutral. Verified on real palettes:
- PIT (gold body): keeps real near-black secondary (was -> white).
- LV / IND (black/navy body): keep real silver secondary (was -> white).
- CLE (brown body): orange-tint clears 3.4, kept on-brand (was -> white).
- KC (scarlet) / NYJ (green): no brand tint clears 3.4 -> legible neutral (correct).

While fixing this I also caught a REAL run-7 bug: the old neutral fallback used a
`luminance(primary) > 0.56` GUESS to pick white vs near-black. On a mid-value body
(e.g. scarlet `#E31837`, where white=3.26 and near-black=2.94 BOTH miss 3.4) that
guess could return the LOWER-contrast neutral. Replaced with a true highest-contrast
pick over the FULL candidate set, so the number is always the most legible option the
body allows. Net: legibility is never worse, and is on-brand far more often.

### Node accounting (honest)
**0 node delta at every size, every sport.** Every edit was an attribute VALUE change
on an existing element (fillOpacity / strokeOpacity / strokeWidth / gradient Stop
stopColor) or a comment; the contrast guard is pure JS (candidate array grew 6->10
strings, evaluated once per memoized mount — no render nodes, no per-frame cost). No
SVG element added or removed anywhere. Thumbnail (<40) tier is node-stable and only
gained punchier trim VALUES on fills it already drew; the reduced-detail guards are
unchanged (cuff accent stripes / parallel sash piping still gated off thumbnails).

### Tests
- Retuned the run-7 contrast-guard test to the run-8 brand-first + highest-contrast
  fallback logic (the old `if (contrastRatio(best…) < 3.4)` line was removed).
- ADDED `run 8 anti-over-snap`: re-implements the exact guard and asserts PIT/IND/LV
  keep their real brand color, the result clears 3.4 where the body allows, and on a
  no-brand-pass body the pick is never lower-contrast than the best neutral.
- ADDED `run 8 near-solid trim`: locks the lifted football/hockey/basketball/cricket
  trim opacities + the vivid trim ramp.
- Suite: **26/26 pass** (24 prior + 2 new). `tsc -p tsconfig.app.json --noEmit`: **0
  errors** across the whole app. Pre-existing non-jersey `GameCardRaisedBorder`
  projected-score-format test still fails (untouched, out of lane, since run 3).

### Perf
Static / declarative / deterministic / memoized; no runtime filters, no per-frame
work, no new deps. 0 node delta everywhere. Device FPS: NOT MEASURED — no live
device-FPS capture exists here (no-mock-data rule). A scroll-FPS regression is not
plausible: node count is identical, the only change is constant fill/stroke opacity
values and one-time color selection; rasterization cost per memoized mount is
effectively unchanged. Thumbnails confirmed light (node-stable).

### Gate decisions — ALL QUEUED
- Near-solid confident trim across all 9: QUEUED — kills the washed/muddy trim tell,
  whole garment now matches the bold lettering, 0 nodes.
- Vivid trim ramp: QUEUED — keeps the now-solid trim punchy end-to-end, 0 nodes.
- Contrast-guard anti-over-snap + highest-contrast fallback bug fix: QUEUED — more
  on-brand AND strictly more legible, 0 nodes.
- Nothing discarded; every change earned a bold-graphic gain on a zero-node budget.

### Next target
(a) A few teams have secondary ~= primary (e.g. very dark-on-dark); the near-solid
trim relies on adjacent dark-stitch/AO strokes for edge separation — spot-check those
read crisply and add a thin auto-keyline on trim only if a case looks muddy. (b) The
faux-italic kit-number shear for soccer/MLS (carried from run 7). (c) Hero back-view
variant to showcase the bold arced nameplate over a large back number.

## Run 7 — 2026-05-29 — DIRECTION CHANGE: BOLD BROADCAST GRAPHIC + NAME/NUMBER OVERHAUL

### Context / directive
Deepak picked a TARGET LOOK when shown options: "bold broadcast graphic" — EA
Sports / ESPN team-graphic style: punchy high-contrast color, crisp clean edges,
confident bold numbers. He explicitly did NOT pick photoreal. Runs 5-6 had
trended subtle/photoreal (matte sheens, soft form shadows, fill/outline muddied
toward the body). This run REBALANCES toward bold/crisp/graphic. His #1 gripe was
"the team name/number" — so the LETTERING is the centerpiece. Kept all run-1..6
construction/silhouettes/placement-mechanics (labelArcPath/glyph()/TextPath
nameplate, two-ply twill, optical kerning, reduced-detail tier, form-shadow core,
soft contact shadow); RETUNED the photoreal-leaning values toward bold-graphic.

### PRIORITY 1 — NAME/NUMBER, broadcast-grade (the centerpiece)
The old `EmbroideredLabel` stacked ~11 passes per line, several of them low-opacity
HAZE fills (`surface_shadow` 0.11, `surface_highlight` 0.08, `cloth_grain` dashed
0.18, `highlight` 0.13) on top of a fill that was MIXED 7-12% toward the body color
and an outline at `strokeOpacity 0.84` mixed 12% toward the body. That combination
read soft, muddy and washed — the exact "photoreal-leaning" problem. Rebuilt the
stack as a crisp broadcast graphic:
- **PURE PUNCHY FILL:** `integratedFill` mix toward body dropped 7-12% -> 3-5%, and
  `fillOpacity` 0.95 -> 1. The number is now essentially the pure contrast-guard
  color, fully opaque.
- **CRISP TWILL BORDER:** `integratedStroke` no longer mixed toward the body — it is
  now the TRUE outline color at full opacity (was 0.84, muddied 12%). Border weight
  heavier: `fontSize*0.18` cap 2.35 -> `fontSize*0.215` cap 3.1, so the tackle-twill
  reads bold and confident, not thin.
- **NEW HARD KEYLINE:** a clean high-contrast keyline (the OPPOSITE value of the
  outline — near-black `#06080c` or white) rings the whole mark under the twill
  border, so the edges SNAP off the cloth at a glance. This is the single most
  visible "looks more professional" change.
- **CRISP CAST SHADOW:** the old soft 0.1-opacity blur-stroke `depth` pass became a
  real offset (down-right) drop shadow in the keyline color at 0.22-0.34 — gives
  broadcast pop instead of a soft halo.
- **RAISED EMBOSS, not haze:** dropped the muddy `surface_highlight`, `cloth_grain`
  and `highlight` fill-blur passes. Kept ONE crisp inner shadow (lower edge) + ONE
  crisp inner highlight (upper edge) so the twill reads embossed/raised without
  softening the fill. Two-ply satin rim strengthened (0.42 -> 0.6) and crisper.
- **PUNCHIER CONTRAST GUARD:** `readableDetail` fallback threshold raised 2.65 ->
  3.4, and the snap colors went purer (`#101820` -> `#0A1016`, white unchanged), so
  a muted secondary that only just cleared the old bar now snaps to pure white /
  near-black. Mandatory contrast is enforced HARDER, exactly per the directive.
- **HERO NUMBER PROPORTION:** basketball front number 18 -> 21 (maxWidth 30 -> 32,
  y 80 -> 81; wordmark dropped to y 51.5 as the supporting line). Football front
  number 19 -> 22 (maxWidth 32 -> 34, y 87 -> 88; wordmark y 55 -> 54.5). Hierarchy
  now reads number-first on both, as a broadcast team graphic does.

### PRIORITY 2 — bold-graphic rebalance across all 9
- **BODY VALUE RAMP:** the old top stop lifted 32% toward white, desaturating the
  shoulders (washed). New ramp keeps the team color SATURATED with a shorter,
  punchier swing: `lighten(primary,0.32)->0.2` at top, pure primary owning more of
  the chest (0.43 -> 0.46 offset), confident hem shadow `darken 0.38 -> 0.4`.
  Applied to BOTH the shared `ModelDefs` ramp and the basketball inline ramp.
- **TRIM RAMP:** tighter highlight (`lighten(secondary,0.32)->0.24`) + pure secondary
  core so collars/cuffs/panels/stripes read as confident, vibrant accent color
  rather than gradient-faded. Both ramps (ModelDefs + basketball inline).

### Node accounting (honest)
- **Lettering full size (>= 40):** 11 passes/line -> 9 passes/line. **-2 nodes per
  label line** (dropped surface_highlight + cloth_grain + highlight; added 1
  keyline). A net REDUCTION.
- **Lettering thumbnail (< 40):** was keyline-less {depth, outline, fill} = 3; now
  {keyline, outline, fill} = 3 (depth + shadow + embellishment all gated). **±0
  nodes at the 34px thumbnail** (the budget that matters) — and the bold numbers/
  names read CRISPER there now thanks to the hard keyline halo.
- **Body/trim ramps, contrast guard, number sizes:** **0 node delta** (same Stop
  counts / attribute + size changes).
- So run 7 is node-neutral-to-negative everywhere while looking markedly bolder.

### Tests
Updated 4 assertions to the new bold-graphic intent (heavier twill border weight,
dropped cloth_grain pass, reworded basketball comment + y=81, football number 22)
and ADDED 4 run-7 lock-in tests: broadcast keyline + crisp full-opacity twill +
pure fill; the punchier 3.4 contrast guard; the saturated body value ramp; (the
football/basketball hero sizes are covered by the updated proportion tests).
Suite: **24/24 pass.** `tsc -p tsconfig.app.json --noEmit`: **0 errors** across the
whole app. (The unrelated `GameCardRaisedBorder` projected-score-format test still
fails — pre-existing since run 3, non-jersey GameCard.tsx code I did not touch.)

### Perf
All changes are static/declarative/deterministic/memoized; no runtime filters, no
per-frame work, no new dependencies (BebasNeue already loaded). Lettering nodes
went DOWN at full size and stayed flat at thumbnail. Device FPS: NOT MEASURED — no
live device-FPS capture exists here (no-mock-data rule); the deltas are node-
neutral-to-negative with zero per-frame cost, so a scroll-FPS regression is not
plausible and the thumbnail path is node-stable.

### Gate decisions — ALL QUEUED
- Broadcast lettering overhaul (keyline + crisp twill + pure fill + raised emboss):
  QUEUED — clearly more real per the new direction AND fewer nodes at full size.
- Punchier contrast guard: QUEUED — 0 nodes, harder legibility guarantee.
- Hero number sizes: QUEUED — 0 nodes, correct broadcast hierarchy.
- Body/trim value rebalance: QUEUED — 0 nodes, punchier color.
- Nothing discarded; every change earned a visible bold-graphic gain on budget.

### Next target
(a) Per-team a11y spot-check of the 3.4 contrast snap on a few tricky body colors
(e.g. mid-value reds/teals) to confirm it never over-snaps to white when a vibrant
secondary would read better. (b) Consider a subtle BebasNeue-condensed faux-italic
shear option for soccer/MLS kit numbers (broadcast soccer numbers are often
slanted) — gate on whether it stays crisp. (c) Hero back-view variant (carried from
run 4) to showcase the bold arced nameplate over a large back number.

## Run 1 — 2026-05-29

### Context
First run. Inherited an already-strong 2D jersey system in
`src/components/sports/jerseyVisuals.tsx` (one base template per sport, baked
gradient depth, embroidered-look lettering, contrast guard, sport-correct
silhouettes, no runtime filters). An in-progress uncommitted edit had just added
`memo()` to `MiniJerseyModel` — I built on top of that clean baseline.

### Change: baked diagonal specular sheen band
**What:** Added a single diagonal white linear gradient (`ids.sheen`) clipped to
the jersey body, rendered just above the volume/edge lighting and below the
weave textures and markings. Applied in both render paths — the generic
`ModelDefs` + clipped group, and the `BasketballSleevelessModel` inline Defs +
clipped group.

**Why this one:** The system already had soft global lighting (radial `volume`,
rim `edge`) but no *directional* specular. A raking shoulder-to-chest highlight
is the single strongest cue that the surface is curved, lit cloth rather than a
flat fill. It is also the cheapest possible realism gain.

**Before:** Body read as evenly-lit fabric; the only "shine" was the faint glass
accent sweep. Shoulders looked rounded but not *lit*.

**After:** A soft highlight rakes across the upper-left shoulder and fades by
mid-chest, so the cloth catches light like a real worn jersey under a key light.
Reads more three-dimensional without touching the silhouette or colors.

### Perf
- Node delta: **+1 gradient def (5 Stops) and +1 clipped Rect per jersey.** That
  is it. Whole-file tag counts after: Path 103, Rect 13, Stop 62,
  SvgLinearGradient 12 (was 10), the rest unchanged.
- Per-frame work: **none.** Declarative gradient + rect, resolved once. No new JS
  loops, no `.map`, no filters (no feGaussianBlur).
- Memoization: intact — `MiniJerseyModel` is memoized and all wrappers/`JerseyIcon`
  are memoized. Still fully deterministic by (team, sport).
- Tests: `JerseyVisualRefinement.test.ts` 4/4 pass; `tsc --noEmit` clean on the
  file.
- Device FPS: **NOT MEASURED.** No live device-FPS capture exists in this
  environment, so I did not fabricate a number (no-mock-data rule). The change is
  +2 static nodes with zero per-frame cost, so a scroll-FPS regression is not
  plausible.

### Gate decision: QUEUED
Both halves of the gate hold: more real (directional specular) AND within budget
(+2 nodes, no per-frame cost, no filters, memoized, deterministic). Queued as a
reviewable diff in the working tree. No git actions taken.

### Next target
Add a reduced-detail tier for the 34px thumbnail path (CompactLiveCard): at that
size the weave dots, stitch dashes, and crest detail are invisible but still cost
nodes. Dropping `TextureLayer`/`ClothFoldLayer`/crest below a size threshold would
cut node count on the smallest, most-numerous jerseys with zero visible quality
loss.

## Run 2 — 2026-05-29

### Context
Resumed on the run-1 working tree (baked sheen band intact, not undone). Confirmed
the render chain: `size` flows JerseyIcon/TeamJerseyCompact -> per-sport wrapper
-> MiniJerseyModel/BasketballSleevelessModel, all memoized, so a size-keyed branch
re-renders correctly. Live sizes in use: 60 (GameCard), 46 (live card), 34
(CompactLiveCard thumbnail, two per card — the most-numerous jersey). Worked three
gated candidates highest-value-first.

### Change 1 (QUEUED): reduced-detail tier below size 40
**What:** Added `REDUCED_DETAIL_THRESHOLD = 40`; `reducedDetail = size < 40` in
both render bodies. Below it we skip the layers that are physically sub-pixel at
that scale: `TextureLayer` (weave), `ClothFoldLayer`, `PanelVolume` fine fold
strokes, and the basketball channel/side-stitch/inner-panel loops. Kept at all
sizes: silhouette, body gradient, volume+edge+sheen rects, the large side/center
AO fills (they read as shading), collar/trim construction, rim/outline, glass, and
lettering.
**Why invisible:** at size 34 the viewBox scale is 0.34 px/unit. A mesh dot
(r=0.45u) renders ~0.31px; a fold stroke (0.55u) ~0.19px — both at/below the
sub-pixel floor and 0.07-0.13 opacity, so they contribute nothing visible.
**Before:** every size rendered full weave/folds — a basketball thumbnail carried
~330 mesh nodes + folds; a football ~243 heavy-mesh nodes — none of it resolvable
at 34px.
**After:** thumbnails drop ~352 nodes (basketball/NCAAB), ~255 (football), ~112
(hockey), ~54 (soccer), ~24 (baseball), ~18 (ucl/cricket/tennis) with zero visible
change. Sizes >= 40 (the 46 and 60 paths) are byte-for-byte the original code (the
else branch is unchanged).
**Perf:** node reduction listed above per sport; +0 static nodes; no per-frame
work; no filters; memoized + deterministic. Per-frame scroll cost on a live-card
list drops because the smallest, most-repeated jerseys now mount far fewer SVG
nodes (and far fewer of the layout-heavy ones).

### Change 2 (QUEUED): ribbed crew collar for soccer/UCL
**What:** The weakest reads-as-cloth element across the 9 was the soccer/ucl
collar — a single flat 3.7u arc stroke + flat AO ellipse, while every other sport
has a modeled neck. Upgraded it to: an inner-neck shadow path (depth into the
opening), the rib band (existing trim arc), a top fold-edge highlight stroke, and
an under-rib seam stroke — the same fill+dark-stroke+light-stroke technique the
basketball/cricket V-necks already use.
**Before:** flat painted-on collar arc, no opening depth.
**After:** the neck reads as folded ribbed cloth with a shadowed opening and a lit
top fold — matches the collar bar set by the other 8 sports.
**Perf:** +3 static Path nodes on soccer/ucl only (Path 103 -> 106 in source);
zero per-frame work; no filters; deterministic + memoized; renders at all sizes
(collar is visible at 34px, and 3 nodes is trivial).

### Change 3 (QUEUED): reduced-detail twill for thumbnail lettering
**What:** `EmbroideredLabel` ran its full 10-pass twill stack (9 SvgText + 1 arc
Path per line, plus a stitch pass) at every size. Added `reducedDetail` to the
label; below the threshold it collapses to the 3 passes that actually read at
34px — depth cast-shadow, integrated outline, fill — dropping the arc shadow,
surface shadow/highlight, inset, cloth-grain dash, highlight, and stitch dash
(all sub-pixel at that scale). Threaded the flag through `GarmentMarkings` and the
basketball model's inline label calls.
**Before:** thumbnails laid out ~10 glyph-shaped passes per label — SvgText is the
most expensive node type (per-glyph layout) — for embellishment invisible at 34px.
**After:** ~3 passes per label at thumbnail size; identical full twill at >= 40.
**Perf:** roughly -7 to -14 nodes per thumbnail (1-2 labels), and these are the
costly SvgText/text-layout nodes, so the mount saving is disproportionate. +0
static nodes; no per-frame work; no filters; memoized + deterministic. Tests still
pass (the asserted source strings — `strokeOpacity={0.16}`, the applique keys —
are retained, just wrapped).

### Change 3b (DISCARDED): chest-curve text warp (textPath)
**What considered:** warping the front number / nameplate baseline to follow the
chest curve via `textPath`.
**Why discarded:** at the live sizes the believable baseline sagitta is ~1.5-2u
over a ~25u word, i.e. ~0.9-1.2px of bow at size 60 and ~0.5-0.7px at 34 — below
the visible threshold. Meanwhile textPath would add a Defs path per label and
break the tuned multi-line `fittedLabelLayout` anchor model. Fails the gate: no
meaningful realism gain at real sizes, real cost + risk. The existing per-sport
rotation (cricket -10, tennis -6, baseball -5) already supplies the readable arc
cue.

### Gate decisions
- Change 1: QUEUED. Change 2: QUEUED. Change 3: QUEUED. Change 3b: DISCARDED.
- Device FPS: NOT MEASURED (no live device-FPS capture here; per no-mock-data rule
  I did not fabricate one). All changes are static-node reductions or +3 static
  nodes with zero per-frame work, so a scroll-FPS regression is not plausible; the
  thumbnail-tier changes should reduce mount/scroll cost on the most-repeated cards.

### Next target
Two candidates for run 3: (a) extend the reduced-detail tier to also collapse the
`LegalSafeCrest` micro-marks and the multi-stroke hem/seam construction below the
threshold (crest text is unreadable at 34px); (b) bring the baseball pinstripe and
the hockey knit-dot grid into a single cheaper texture primitive at mid sizes (46)
where individual dots start to alias. Measure crest legibility before touching it.

## Run 3 — 2026-05-29 — MAJOR REFINEMENT PASS

### Context / directive
Deepak's directive: "refine the look of every league and jersey — a realistic
shape and build, the team name placed a LOT better, and overall make all the
jerseys look professionally made." Resumed on the run-1/run-2 working tree;
nothing from prior runs undone (baked sheen, soccer/ucl ribbed crew collar,
reduced-detail tier, thumbnail twill simplification all intact). Confirmed the
contract: colors arrive as props from `getTeamColors` (no hardcoded hex in the
jersey file); `MiniJerseyModel` memoized + deterministic by (team, sport); live
sizes 60/46/34. react-native-svg is 15.11.2 and exports `TextPath`.

### Change A — REAL nameplate / chest-script ARC (Deepak's #1 complaint)
**The problem:** the only "arc" before was a `rotation` prop (cricket -10,
tennis -6, baseball -5) that tilted the whole word — so the name read as
*crooked*, not curved. That is almost certainly what looked "placed badly."
**What:** added a `labelArcPath(cx, baselineY, halfWidth, arc)` helper that builds
ONE quadratic arc per line, and gave `EmbroideredLabel` an `arc`/`arcId` pair.
When `arc !== 0` on a single-line mark, every twill pass now runs the whole word
along that arc via a single `<TextPath href startOffset="50%">` instead of a flat
`x/y` baseline. Centralised flat-vs-arced emission in one `glyph()` helper so all
10 twill passes share it — meaning an arced nameplate costs the SAME node count
as a flat one (one text element per pass, not one per glyph). This is the exact
case run-2 discarded *for the front-number micro-bow* (sub-pixel) — but a
nameplate arc is a large, intended, clearly-visible curve, so the gate flips.
**Applied per convention:** baseball chest script `arc=3.8`, hockey back
nameplate `arc=3.4`, cricket back nameplate `arc=3` (all bow upward like a real
nameplate). Tennis dropped its -6 tilt and went clean/flat (polo convention).
Basketball / football / soccer / UCL stay straight (correct front-chest /
minimal convention). Contrast guard (`readableDetail`/`readableOutline`) and the
multi-line fitter are unchanged, so legibility on every team color is preserved.
arcId is namespaced to the unique clip id so multiple cards never share a Path id.
**Before:** tilted/crooked-looking team names on baseball/cricket/hockey.
**After:** confident curved nameplates that follow the cloth like real twill.
**Perf:** +1 static arc `Path` per arced label, zero per-frame work, no filters.

### Change B — REALISTIC SHAPE: distinct tennis polo + collared cricket
**Tennis (weakest silhouette — was a near-copy of soccer):** rebuilt the neck as
a real polo — a turn-down collar (two pointed wings + centre notch on an
inner-neck shadow) plus a short button placket (fold-shaded strip + 2 buttons).
Removed the two soccer-style diagonal side seams that made it read like a kit.
Now unmistakably a polo. Net +5 static construction nodes on tennis only.
**Cricket:** added open turn-down collar wings over the V-neck so it reads as a
"collared colored jersey" per spec. +3 static nodes on cricket only.

### Change C — PROFESSIONAL FINISH
Lighting/sheen direction was already consistent (top-left key, shoulder->chest
sheen) and shared via `ModelDefs` (+ a matching inline Defs for basketball); this
pass kept that and made the lettering treatment consistent across sports by
routing every twill pass through the single `glyph()` helper (one source of truth
for fill/outline/emboss/stitch), so all 9 share one applique system.

### Tests
Updated `JerseyVisualRefinement.test.ts`: the two assertions that matched the old
inline `key={`applique_surface_shadow...`}` / `key={`applique_cloth_grain...`}`
strings now assert the same passes by their stable key labels (they moved into
the `glyph()` helper — intentional structural change to enable the arc at equal
node cost). Added two new tests: the TextPath nameplate-arc system, and the
distinct tennis polo. Suite: 6/6 pass. `tsc -p tsconfig.app.json` clean. (The
failing `GameCardRaisedBorder` projected-score-order test is pre-existing,
outside the jersey lane, and reads GameCard.tsx which other in-progress work had
already modified — its two jersey-relevant assertions both pass.)

### Perf (per sport, vs run-2)
- Hockey: +1 node (arc path on the nameplate when wordmark != label).
- Baseball: +1 node (arc path; removed a rotation transform attr — no node cost).
- Cricket: +4 nodes (+1 arc path, +3 collar-wing paths).
- Tennis: +5 nodes (polo placket + collar wings, minus 2 removed side seams).
- NBA/NCAAB/NFL/NCAAF/soccer/UCL: unchanged (intentionally straight names).
All additions are static, declarative, deterministic, memoized; no runtime
filters, no per-frame work, no new dependencies (TextPath ships with the existing
react-native-svg 15.11.2). Device FPS: NOT MEASURED — no live device-FPS capture
exists here (no-mock-data rule); the deltas are 1-5 static nodes on the
less-listed sports with zero per-frame cost, so a scroll-FPS regression is not
plausible. Thumbnails: reduced-detail tier from run-2 still applies to weave/
folds/twill embellishment; the new arc + polo construction render at all sizes
(arc curvature is still ~2.3-2.6px of bow at 34px and reads; the polo buttons go
sub-pixel at 34px but are only +2 static nodes on a rarely-listed sport).

### Gate decisions
- Change A (nameplate arc): QUEUED — clearly more real (fixes the #1 complaint),
  +1 node/arced label, equal node cost vs flat, no per-frame work.
- Change B (tennis polo / cricket collar): QUEUED — distinct correct silhouettes,
  +3 to +5 static nodes on two low-frequency sports.
- Change C (finish consolidation): QUEUED — same look, one applique source of
  truth across all 9.

### Next target
(a) Thread `reducedDetail` into `SportConstruction` so the tennis polo buttons /
thin highlight strokes and the cricket collar-highlight strokes (all sub-pixel at
34px) drop on thumbnails. (b) Consider a true back-view variant for football/
hockey so the arced nameplate over a large back number can be shown at hero size.
(c) Collapse `LegalSafeCrest` micro-text below the threshold (carried over from
run-2).

## Run 4 — 2026-05-29 — MAJOR REFINEMENT PASS (the "fine, unchanged" sports)

### Context / directive
Deepak's directive: ELEVATE the sports run 3 left "reviewed, unchanged" (NBA,
NCAAB, NFL/NCAAF, MLS/EPL soccer, UCL) to the same professional bar, then a
cohesion sweep so all 9 read as one designed family. Resumed on the run-1/2/3
working tree — nothing undone (baked sheen, ribbed soccer/UCL crew collar,
reduced-detail tier, thumbnail twill, labelArcPath/glyph()/TextPath nameplate,
tennis polo, cricket collar all intact and verified). Surgical edits to
`jerseyVisuals.tsx` + its test only.

### Change FOOTBALL (QUEUED) — sell the pads + real TV numbers (biggest win)
**The problem:** the football "pads" were a single flat trim fill at 0.2 opacity
— the silhouette's signature was not selling. TV-number "flashes" were empty
quad placeholders. No real cuffs.
**What:** rebuilt the shoulders as BAKED VOLUME — a broad white highlight cap
catching the top-left key, a curved black AO crease where the pad rolls into the
sleeve, plus a colored yoke trim band and lit pad-edge strokes — so each shoulder
reads as a foam pad under cloth. Added real short-sleeve cuff bands (trim fill +
fold highlight + under-cuff shadow) at each sleeve end. Replaced the empty flash
quads with REAL twill TV numbers (`jerseyNumber`) on each shoulder pad, and added
a big weighted front number under the chest wordmark. Threaded `number` into
`GarmentMarkings`. Removed the center chest shield crest (it collided with the
front number; real football fronts are number-forward, not crested).
**Node delta:** construction 8 -> 17 full / 9 reduced; markings: dropped the
crest (~4) + 2 flash paths, added 3 EmbroideredLabels. Full-size markings ~+22
static text-pass nodes; at 34px thumbnail the reduced-detail tier collapses every
label to 3 passes so the thumbnail nets ~+3.

### Change BASKETBALL (QUEUED) — cut-and-sewn tank: side panels + binding depth
**What:** added contrast SIDE PANELS (secondary-toned fill hugging each torso
edge from armhole to hem) bounded by a PIPING seam (dark stitch + lit fold edge),
so the body reads as a paneled cut-and-sewn garment. Strengthened the neck
BINDING (cast AO below the binding + top fold highlight + inner seam) and added
an UNDER-ARM AO where each armhole binding sews to the body — both now read as
real openings, not painted arcs. The big chest number already had twill depth via
`EmbroideredLabel` (unchanged).
**Node delta:** +4 panel fills (full+reduced) + 4 piping strokes (full only,
reducedDetail-guarded) + 2 neck paths + 2 under-arm AO fills. ~+8 full, +6
reduced on the basketball model only.

### Change SOCCER / UCL (QUEUED) — modern technical kit, not a tee-with-collar
**What:** added a diagonal RAGLAN seam (collar -> underarm, per side), a flank
side-panel seam, turned-cuff seams (lit fold + under-cuff shadow on the existing
cuff fills), and a DOUBLE hem (trim + lit fold edge). The kit now reads as
engineered panels. The run-2 ribbed crew collar and the legal-safe crest are
unchanged.
**Node delta:** +6 seam strokes + 4 cuff seams + 1 hem accent = ~+11 full; all
are <=0.78u sub-pixel strokes wrapped in the reduced-detail guard, so +0 at
thumbnail.

### COHESION SWEEP (QUEUED) — one designed family + one thumbnail rule
- **Light direction:** confirmed every new highlight sits at the TOP / top-left
  (pad caps, collar/cuff/binding fold highlights all use `lighten(secondary,0.5)`
  at the upper edge) and every AO sits below/under (`#000000` 0.10-0.16). Matches
  the existing top-left key + shoulder->chest sheen. Consistent across all 9.
- **Edge/seam treatment:** standardized on one vocabulary now shared by all 9 —
  dark stitch `#05070a` ~0.5-0.9u @ 0.2-0.28, lit fold edge `lighten(secondary,
  0.5)` ~0.46-0.92u @ 0.4-0.5, accent piping at low opacity. Football, basketball,
  soccer/UCL, cricket, tennis now all speak it.
- **Thumbnail rule made uniform:** threaded `reducedDetail` into
  `SportConstruction` and gated the new sub-pixel seam strokes on football,
  soccer/UCL, AND (for consistency) the run-3 cricket collar-highlight /
  hem-accent and the tennis placket-seam / collar-wing-highlight / buttons. This
  finishes run-3's flagged "next target (a)". Large fills (pads, panels, cuffs,
  collars, hem trim) stay at 34px because they read; only sub-pixel strokes drop.

### Tests
Added 4 new tests to `JerseyVisualRefinement.test.ts` locking the run-4 features
(football pads + TV numbers, basketball side panels + piping, soccer raglan kit,
the reduced-detail gating of the new seams). Suite: 10/10 pass. `tsc -p
tsconfig.app.json` clean on the file. (The unrelated `GameCardRaisedBorder`
projected-score-format test still fails — pre-existing, documented in run 3,
non-jersey code in GameCard.tsx that I did not touch.)

### Perf
All additions are static, declarative, deterministic, memoized; no runtime
filters, no per-frame work, no new dependencies. Largest add is football
full-size markings (~+22 static text-pass nodes) — but football is not the
most-numerous jersey, and at the 34px thumbnail (the most-repeated, the budget
that matters) the reduced-detail tier holds it to ~+3, and every new construction
seam is fully gated to +0 at thumbnail. Device FPS: NOT MEASURED — no live
device-FPS capture exists here (no-mock-data rule); the deltas are static nodes
with zero per-frame cost, so a scroll-FPS regression is not plausible, and the
thumbnail tier (the most-numerous path) stays within a few nodes of run 3.

### Gate decisions
- Football pads + TV numbers: QUEUED. Basketball side panels + binding: QUEUED.
  Soccer/UCL raglan kit: QUEUED. Cohesion sweep + thumbnail gating: QUEUED.
- Nothing discarded this run — every primary target earned a visible, on-budget
  improvement.

### Next target
(a) A hero/large back-view variant for football + hockey so the arced nameplate
over a big back number can be shown at detail size. (b) Collapse `LegalSafeCrest`
micro-text below the threshold (carried from run 2). (c) Consider a faint
gradient-driven shoulder-pad sheen on football at large sizes only.

## Run 5 — 2026-05-29 — CRAFT ELEVATION (fidelity & taste, not rebuild)

### Context / directive
Deepak: "refine the designs to look more professional, like an actual graphic
artist made it." Runs 1-4 BUILT the jerseys (right silhouettes, real
construction, fixed name placement, cohesion). Run 5 raises FIDELITY and TASTE on
top — typography, lighting placement, proportion — without regressing any
prior work. Resumed on the run-1..4 working tree; everything intact and verified
(baked sheen, ribbed soccer/UCL collar, reduced-detail tier, labelArcPath/glyph()
/TextPath nameplate, tennis polo, cricket collar, football pads, basketball
panels, soccer raglan kit, unified light/seam vocabulary). Surgical edits to
`jerseyVisuals.tsx` + its test only. NO git, NO new deps, NO runtime filters.

### Change 1 (QUEUED) — TYPOGRAPHY: optical kerning (the #1 amateur-vs-pro tell)
**What:** added a single `letterSpacing={tracking}` attribute to the shared
`glyph()` helper so EVERY twill pass is set with the same negative tracking
(`-fontSize * 0.03` for marks <=3 chars / numerals, eased to `0.022` <=6,
`0.014` longer). Block/varsity jersey lettering is set TIGHT; default system
spacing was the amateur tell. Because it lives in the one shared helper, all
plies stay in perfect registration (critical — split kerning would misalign the
layers). Because the tracking is NEGATIVE, rendered width is slightly under the
estimator, so it can never overflow the fitted `maxWidth` — only ever tightens.
**Node delta: 0** (an attribute on the existing text node).

### Change 2 (QUEUED) — TYPOGRAPHY: true two-ply tackle-twill
**What:** real applied lettering is two stitched plies — a backing ply (the
outline color, peeking out as an even border) + a top ply (the fill) sewn on with
a satin-stitch edge. We already painted the backing (`applique_outline`); added
`applique_top_ply` — a thin crisp rim a touch brighter than the fill, hugging the
glyph exactly — so the eye reads two registered layers (a designed applique)
instead of one stroked glyph. The rim stays in the fill color family
(`lighten(integratedFill, ...)`), so it never fights the contrast guard.
**Node delta:** +1 SvgText pass per label LINE, INSIDE the reduced-detail guard
=> +0 at the 34px thumbnails (the budget that matters); full-size per-sport:
basketball +2, football +4, baseball +1, hockey +1..2, soccer/UCL/cricket/tennis
+1..2. Zero per-frame cost; deterministic; memoized.

### Change 3 (QUEUED) — LIGHTING: key + specular placed PER GARMENT
**What:** the sheen was one generic diagonal band stamped on every shirt. Added
`lightingProfile(variant)` and threaded `variant` into `ModelDefs`; the SAME
gradient DEFS now take per-garment geometry (zero added nodes): football = broad
soft low-gloss sheen high on the pad cap + higher/wider key (heavy twill);
soccer/UCL = crisp tighter brighter specular streak (smooth tech-poly); baseball
= softest most diffuse, lowest gloss (matte flannel/knit); hockey = broad low
diffuse (heavy knit); default (cricket/tennis) = balanced poly. The key falloff
(volume radial peak) is tuned to how each textile reflects. **Node delta: 0.**

### Change 4 (QUEUED) — PROPORTION: basketball front number is the hero
**What:** on a real NBA/NCAAB tank the front number is the dominant chest
element. Enlarged it (14 -> 18) and recomposed the chest: wordmark 54.5 -> 52.5,
number 77 -> 80, giving the number room above the hem and a clear hero read.
**Node delta: 0** (same label, larger size + reposition).

### Restraint calls (audited, already at the pro bar — effort spent elsewhere)
- Football pad volume + cuffs + TV numbers (run 4) and the baseball chest-script
  arc, hockey/cricket nameplate arcs (run 3) are at the bar; they only GAINED
  from the run-5 two-ply twill + kerning, no geometry change needed.
- Trim/accent gradients + body 5-stop value hierarchy: clean light-to-dark read
  already; the text contrast guard protects legibility. Left untouched to avoid
  regressing the run-4 cohesion vocabulary.
- Silhouette proportions (runs 1-4): re-audited shoulder/neck/sleeve/hem ratios
  per sport; no toy-like tells remained that warranted reshaping the body paths.

### Tests
Added 4 run-5 lock-in tests (optical kerning, two-ply tackle-twill, per-garment
lighting, dominant basketball number). Suite: **14/14 pass.** `tsc -p
tsconfig.app.json --noEmit`: **0 errors across the whole app.** No prior test
changed (run-5 is additive on top of runs 1-4).

### Perf
All four changes are static/declarative/deterministic/memoized; no runtime
filters, no per-frame work, no new dependencies. Three of the four are **+0
nodes** (kerning attr, per-garment lighting params, number resize). The only node
add is the two-ply rim, **+1 per label line and fully gated to +0 at the 34px
thumbnail tier** (the most-numerous jersey, the budget that matters). Device FPS:
NOT MEASURED — no live device-FPS capture exists here (no-mock-data rule); the
deltas are 0 or a few static nodes at large sizes only, with zero per-frame cost,
so a scroll-FPS regression is not plausible and the thumbnail path is byte-stable.

### Gate decisions
- Optical kerning: QUEUED. Two-ply tackle-twill: QUEUED. Per-garment lighting:
  QUEUED. Dominant basketball number: QUEUED. Nothing discarded — each earned a
  visible craft gain on budget (3 of 4 at zero node cost).

### Next target
(a) Per-garment number proportion pass for football/hockey/baseball back-style
numbers at hero size. (b) Optional engineered-knit micro-gradient per textile
(mesh vs flannel vs heavy-knit) at size >= 40 only. (c) Hero back-view variant
(carried from run 4) to showcase the arced nameplate over a large back number.

## Run 6 — 2026-05-29 — VALUE/DEPTH + "DRAWN-BY-CODE" TELLS

### Context / directive
Deepak (again): "make them all look more professionally done" — repeated, so the
result still wasn't reading as fully pro. Mandate this run: a HARSH art-director
audit first, then FIX the real gaps (no coasting, no "all at bar"). Resumed on the
run-1..5 working tree, nothing undone (sheen, collars, reduced-detail tier,
labelArcPath/glyph()/TextPath nameplates, tennis polo, cricket collar, football
pads, basketball panels+number hierarchy, soccer raglan kit, per-garment
lightingProfile, two-ply twill, optical kerning all intact + verified 14/14).

### STEP-1 AUDIT (what still read as amateur)
- **ALL 9 — body lighting:** the body linear gradient runs corner-to-corner
  (`x1=0.08 y1=0 -> x2=0.92 y2=1`), reading as a flat laminated sheet; the volume
  radial peaks were low (0.14-0.2) so value contrast was compressed = the
  washed-out / airbrushed tell. The torso didn't read as a rounded form.
- **ALL 9 — grounding:** the contact shadow was a flat HARD-EDGED ellipse (a gray
  pill), so the jersey looked pasted on, not sitting in space.
- **MLB:** dead-straight vertical pinstripes across a curved torso — a top
  "drawn by code" tell; real pinstripes bow with the chest.
- **NBA/NCAAB:** side panels were a flat single-opacity fill = a colored stripe,
  not a separate fabric panel with its own light.
- **NHL:** hem/cuff stripes were unrelated single-color rects with a gap — read
  as accidental, not a coordinated designed stripe set.
- **NFL/NCAAF:** front number (fontSize 16) was undersized for the padded
  silhouette vs real broadcast numbers.
- **CRICKET:** the lone diagonal trim line read as a stray accidental mark, not a
  designed flash.

### Change A (QUEUED) — SOFT CONTACT SHADOW (grounding, all 9)
Replaced the flat hard ellipse(s) with one gradient-filled ellipse driven by a new
`ids.contact` radial (dense centre -> feathered transparent edge), in BOTH the
shared `ModelDefs` and the basketball inline Defs. Garment now sits in space.
**Node delta:** +1 gradient def; rendered **+1 Rect/Ellipse fill but -1 Ellipse**
(was 2 grounding ellipses, now 1) = net ~0 nodes, both render paths, all sizes.

### Change B (QUEUED) — FORM-SHADOW CORE (value/depth, all 9)
Added `ids.core` — a vertical-ish radial (transparent core -> dark at flanks/hem)
painted clipped to the body, just under the sheen — so the torso reads as a
rounded volume with honest value contrast instead of a single diagonal sheet.
**Node delta:** +1 gradient def + **+1 clipped Rect** per render path (all sizes;
it reads as legitimate shading, not sub-pixel detail, so correctly NOT gated).

### Change C (QUEUED) — CURVED BASEBALL PINSTRIPES (drawn-by-code tell)
Converted the 12 dead-straight `<Line>` pinstripes to quadratic-curve `<Path>`s
via a `pinstripe(x)` helper whose bow scales with distance from centre, so the
set bows with the chest like cloth on a body. **Node delta: 0** (Path replaces
Line, same count). Already inside the reduced-detail weave guard => +0 thumbnail.

### Change D (QUEUED) — NBA SIDE PANELS AS SEPARATE TEXTILES
Each side panel now carries its own light — a pooled dark hem shadow + a lit
armhole cap — so it reads as a cut-and-sewn fabric panel, not a flat colored
stripe. **Node delta:** +4 fills (2 dark + 2 lit) on the basketball model only,
all sizes (they read as shading at 34px).

### Change E (QUEUED) — NHL COORDINATED STRIPE SET
Hem + both cuffs now share one designed band: a wide trim stripe carrying a thin
contrast accent centre stripe. **Node delta:** +1 hem accent Rect (all sizes) +2
cuff accent Rects (reducedDetail-gated => +0 thumbnail). Hockey only.

### Change F (QUEUED) — FOOTBALL FRONT NUMBER TO BROADCAST PROPORTION
Front number 16 -> 19 (maxWidth 30 -> 32), wordmark nudged 56 -> 55, number
86 -> 87 so the number owns the lower chest. **Node delta: 0** (resize/reposition).

### Change G (QUEUED) — CRICKET DESIGNED DIAGONAL FLASH
The lone stray diagonal became a coordinated sash: a wider trim band with a
parallel accent pinstripe + a lit edge running alongside it. **Node delta:** same
1 band Line at all sizes; +2 thin parallel accents (reducedDetail-gated => +0
thumbnail). Cricket only.

### Tests
Added 7 run-6 lock-in tests (contact shadow, form-shadow core, curved pinstripes,
panel falloff, hockey stripe set, cricket flash, football number proportion).
Suite: **21/21 pass.** `tsc -p tsconfig.app.json --noEmit`: **0 errors across the
whole app.** No prior test changed (run-6 is additive). The pre-existing
non-jersey `GameCardRaisedBorder` score-format test still fails (documented runs
3-5, out of lane, GameCard.tsx untouched).

### Perf
All changes static/declarative/deterministic/memoized; no runtime filters, no
per-frame work, no new deps. Net rendered node delta is ~0 on the contact-shadow
swap (ellipse -> gradient ellipse), +1 clipped Rect for the core (both ~free),
0 for pinstripes (Path<->Line) and the football number; the only real adds are
+4 (NBA panel shade), +1..3 (NHL stripe accents), +0..2 (cricket flash) — each on
a single non-most-numerous sport, with the thin accents gated to +0 at the 34px
thumbnail. Device FPS: NOT MEASURED — no live device-FPS capture here
(no-mock-data rule); deltas are 0-to-a-few static nodes with zero per-frame cost,
so a scroll-FPS regression is not plausible and the thumbnail path stays light.

### Gate decisions
- A contact shadow / B form-shadow core / C curved pinstripes / D panel shade /
  E stripe set / F football number / G cricket flash: ALL QUEUED — each fixes a
  named audit tell and holds the budget. Nothing discarded; every audit gap got a
  fix.

### Materially more professional this run
The two universal changes (form-shadow core + soft contact shadow) lift ALL 9 at
once — they fix the washed-out value read and the pasted-on grounding, which were
the biggest remaining "amateur" tells. MLB (curved pinstripes), NBA (panel shade),
NHL (stripe set), NFL (number proportion) and cricket (designed flash) each got a
specific per-sport fix. Remaining gap: a true hero back-view variant and engineered
per-textile knit micro-gradients are still future work (size >= 40 only).

### Next target
(a) Engineered per-textile knit micro-gradient (mesh/flannel/heavy-knit) at hero
size only. (b) Hero back-view variant for the arced nameplate over a big number.
(c) Soccer/UCL subtle sublimated tonal panel gradient at large sizes.
