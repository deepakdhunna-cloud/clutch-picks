# Jersey Gallery

One base 2D SVG template per sport, driven by `MiniJerseyModel` in
`src/components/sports/jerseyVisuals.tsx`. Thin per-sport wrappers
(`NBAJersey`, `NFLJersey`, ...) select a `JerseyModelVariant`. Colors come from
`getTeamColors(abbr, sport)` in `src/lib/team-colors.ts`. Numbers/wordmarks are
deterministic by (team, sport). All depth is baked gradients + overlays — no
runtime SVG filters anywhere.

| Sport / Variant | Wrapper | Silhouette | Reads as cloth? | Notes |
|---|---|---|---|---|
| NBA `basketball` | NBAJersey | Sleeveless tank, V-rounded neck, wide armholes, CONTRAST SIDE PANELS + piping, big front number | Yes | Dedicated `BasketballSleevelessModel`. Run 4: secondary-toned side panels bounded by lit/dark piping seam; neck binding now has cast AO + top fold highlight + inner seam (cut-and-sewn); under-arm AO at each armhole. Team name straight across chest (correct). |
| NCAAB `college-basketball` | CollegeBBJersey | Same sleeveless tank | Yes | Shares the basketball model (gets the run-4 panels/binding too). |
| NFL / NCAAF `football` | NFLJersey | PADDED shoulders (baked volume), short-sleeve cuffs, crew collar, REAL TV numbers, weighted front number, chest wordmark | Yes | Heavy-mesh weave. Run 4: pads rebuilt as baked volume (highlight cap + AO crease where pad meets sleeve); real cuff bands; empty flash quads replaced with real twill TV numbers on each shoulder + a big front number; dropped center crest (number-forward, like a real football front). |
| MLB `baseball` | MLBJersey | Button-front placket, piping down front + sleeves, pinstripe weave, chest script | Yes | Run 3: chest script now follows a REAL upward arc (TextPath, arc=3.8) instead of a -5 tilt — reads as classic baseball script. |
| NHL `hockey` | NHLJersey | Looser sweater, lace-up collar, chest crest oval, sleeve + hem stripes | Yes | Knit weave. Run 3: back nameplate now ARCS over the lower number (TextPath, arc=3.4). Crest area = legal-safe oval. |
| MLS / EPL `soccer` | SoccerJersey | Fitted technical kit — raglan seam, flank panel seam, ribbed crew collar, turned cuffs, double hem, generic chest crest | Yes | Speckle weave. Run 4: diagonal raglan + side-panel seams + turned-cuff seams + double hem so it reads as engineered panels, not a tee. Ribbed crew collar (run 2). Minimal/clean name (correct). No real sponsor marks (legal guard). |
| UCL `ucl` | UCLJersey | Same fitted technical kit + star roundel crest | Yes | Sheen weave. Shares the run-4 raglan/panel/cuff/hem build with soccer. Star badge generic. Minimal name. |
| IPL `cricket` | CricketJersey | Collared colored jersey, arced back wordmark, chest crest | Yes | Sheen weave. Run 3: back wordmark now ARCS (TextPath, arc=3) instead of a -10 tilt; added open turn-down collar wings so it explicitly reads as collared. |
| TENNIS `tennis` | TennisJersey | Polo cut — turn-down collar wings + button placket | Yes | Sheen weave. Run 3: rebuilt as a real polo (collar wings + centre notch + 2-button placket; removed the soccer-style side seams). Name now clean/flat (dropped the -6 tilt). |

## Run 8 — bold broadcast graphic carried through the WHOLE garment + contrast-guard anti-over-snap
Run 7 made the LETTERING bold/crisp/pure; run 8 makes the rest of the garment keep
up so the whole jersey reads as one confident broadcast graphic. Finish/color/
contrast only — no geometry change, **0 nodes added at any size, any sport.**
- **ALL 9 — near-solid confident trim:** every collar/cuff/panel/stripe/placket/
  sash/yoke/crest was still semi-transparent (fillOpacity 0.24-0.76) over the body,
  so the secondary read washed/muddy next to the pure-color text. Lifted the major
  trim surfaces to near-solid (e.g. football yoke 0.34->0.82 + cuffs ->0.92; hockey
  hem set ->0.95 + crest ->0.9; basketball side panels ->0.88/0.92; cricket sash
  ->0.78; tennis/soccer cuffs ->0.78). Fold-highlight/AO/seam shading kept on top so
  dimension survives. Trim gradient ramp given a shallower dark falloff so the now-
  solid trim stays vivid end-to-end.
- **ALL 9 — contrast guard anti-over-snap (run 7's flagged next target):** the guard
  now ranks BRAND-FIRST (true secondary/accent, then stronger tints of the same
  color, then neutral white/near-black) and keeps the team's real high-contrast
  color whenever any tint of it clears 3.4 — so PIT keeps near-black, LV/IND keep
  silver, CLE keeps an orange tint instead of all flattening to white. Also fixed a
  real run-7 fallback bug (luminance guess could return the lower-contrast neutral on
  a mid-value body like scarlet) -> now always the highest-contrast option available.

## Run 7 — DIRECTION CHANGE: bold broadcast graphic + name/number overhaul
Deepak picked "bold broadcast graphic" (EA Sports / ESPN team-graphic) over
photoreal, and named the team name/number as his #1 gripe. This run rebalances the
run-5/6 subtle/photoreal lean toward punchy/crisp/high-contrast, with the LETTERING
as the centerpiece. Construction/silhouettes/placement-mechanics from runs 1-6 are
all kept; the photoreal-leaning VALUES were retuned.
- **ALL 9 — broadcast lettering (`EmbroideredLabel`):** the number/name is now an
  EA/ESPN-style hero graphic. Pure fully-opaque fill (no more 7-12% mud toward the
  body); CRISP full-opacity twill border in the true outline color (was 0.84
  opacity, muddied); heavier border weight (cap 2.35 -> 3.1); a NEW hard KEYLINE
  ringing the whole mark in the opposite value so the edges snap; a crisp offset
  cast shadow (was a soft 0.1 blur); and a clean raised emboss (one inner shadow +
  one inner highlight) in place of the muddy surface_highlight/cloth_grain/highlight
  haze. Net **-2 nodes per label line** at full size, **±0 at the 34px thumbnail**
  (and the bold numbers read CRISPER there too).
- **ALL 9 — punchier contrast guard:** `readableDetail` threshold 2.65 -> 3.4; snap
  colors purer. A muted secondary now snaps to high-contrast white / near-black.
- **ALL 9 — saturated body + trim value ramps:** body top stop lift 32% -> 20%
  toward white (kept the team color saturated, not washed); tighter trim highlight.
  Both the shared and basketball-inline gradients. 0 added nodes.
- **NBA/NCAAB:** front number is the hero — 18 -> 21, wordmark dropped to a
  supporting line above it (number-first hierarchy).
- **NFL/NCAAF:** front number 19 -> 22, owning the lower chest under the pads.

## Run 6 — value/depth + "drawn-by-code" tells (audit-driven)
Audit-first pass on top of runs 1-5; nothing regressed. The two universal fixes
lift all 9 at once; the rest are per-sport tell fixes.
- **ALL 9 — form-shadow core (`ids.core`):** a vertical-ish radial wraps the
  flanks/hem under the sheen so the torso reads as a rounded volume with honest
  value contrast, not the old corner-to-corner laminate sheet (the washed-out
  tell). +1 clipped Rect/path, all sizes.
- **ALL 9 — soft contact shadow (`ids.contact`):** the flat hard grounding
  ellipse(s) became one gradient-filled ellipse with a feathered penumbra, so the
  garment sits in space instead of on a gray pill. Net ~0 nodes (2 ellipses -> 1).
- **MLB:** pinstripes now BOW with the chest (quadratic `<Path>` via `pinstripe(x)`,
  bow scales with distance from centre) instead of dead-straight `<Line>`s — 0
  added nodes.
- **NBA/NCAAB:** side panels carry their own light (pooled hem shadow + lit
  armhole cap) so they read as separate cut-and-sewn textiles, not a flat stripe.
- **NHL:** hem + both cuffs are now one coordinated stripe set (wide trim band +
  thin contrast accent centre stripe); cuff accents gated off thumbnails.
- **NFL/NCAAF:** front number 16 -> 19 to broadcast proportion under the pads.
- **CRICKET:** the lone stray diagonal became a designed flash (trim band +
  parallel accent piping + lit edge); accents gated off thumbnails.

## Run 5 — craft elevation (fidelity & taste, applied to ALL 9)
Refinement on top of the run-1..4 build — no rebuild, nothing regressed.
- **Typography (the #1 pro tell):** all lettering now set with optical kerning
  (tight negative tracking eased by mark length) via the one shared `glyph()`
  helper, so every ply stays registered. True two-ply tackle-twill: backing ply
  (outline) + top ply (fill) + a crisp satin-stitch top-ply rim (`applique_top_ply`)
  so numbers/wordmarks read as a designed applique, not stroked text. (Rim gated
  off thumbnails.)
- **Lighting placed per garment:** `lightingProfile(variant)` shapes the SAME
  volume + sheen gradients to each textile (football broad low-gloss on the pad
  cap; soccer/UCL crisp tech-poly streak; baseball softest matte flannel; hockey
  broad diffuse knit; cricket/tennis balanced) — one believable key light, not a
  generic band. Zero added nodes.
- **Proportion:** basketball front number is now the dominant chest element
  (enlarged + recomposed with hem breathing room).
- **Restraint:** football pads/cuffs/TV numbers, baseball/hockey/cricket
  nameplate arcs, trim value hierarchy, and silhouette ratios were audited as
  already at the pro bar — they only gained from the new two-ply twill + kerning;
  no geometry changes forced where the craft gap was not real.

## Run 3 — team-name placement (Deepak's #1 complaint)
The previous "arc" was a `rotation` prop that tilted the whole word, so names read
*crooked* on baseball/cricket/hockey. Replaced with a real curved baseline:
`labelArcPath` builds one quadratic arc per line and the whole word runs along it
via a single `<TextPath>` (one text element per twill pass — an arced nameplate
costs the same node count as a flat one). Arc applied only where convention calls
for it (baseball chest script, hockey + cricket back nameplates). All other sports
intentionally stay straight (basketball/football front-chest, soccer/UCL/tennis
minimal). All 10 twill passes now flow through one `glyph()` helper = one applique
source of truth shared across the 9 sports.

## Run 4 — elevate the "unchanged" sports + cohesion sweep
Run 3 left NBA/NCAAB, NFL/NCAAF, soccer, UCL "reviewed, unchanged." Run 4 brought
all four up: football pads now read as baked foam volume with real TV numbers;
basketball is a cut-and-sewn tank (contrast side panels + piping + binding depth);
soccer/UCL are modern technical kits (raglan + panel + cuff + hem seams).

**Cohesion vocabulary now shared by all 9** (the "one designed family" rule):
- Light: top-left key. Every fold/seam highlight is `lighten(secondary, 0.5)` at
  the UPPER edge; every AO is `#000000` @ 0.10-0.16 below/under the form.
- Seams: dark stitch `#05070a` ~0.5-0.9u @ 0.2-0.28 paired with a lit fold edge
  ~0.46-0.92u @ 0.4-0.5; accent piping at low opacity.
- Thumbnail rule (uniform): `reducedDetail` now threads into `SportConstruction`;
  every sub-pixel seam stroke (football pad/cuff, basketball piping, soccer
  raglan/panel/cuff, cricket wing-highlight/hem-accent, tennis placket/wing/
  buttons) drops below the threshold. Large fills (pads, panels, cuffs, collars,
  hem trim) stay because they read at 34px.

## Render contexts / sizes
- GameCard main jersey: size 60 (`GAME_CARD_JERSEY_SIZE`), via `JerseyIcon`.
- GameCard live state: size 46 (`LIVE_CARD_JERSEY_SIZE`).
- CompactLiveCard thumbnails: size 34 (two per card — the most-numerous jersey).

## Detail tiers (run 2)
- `REDUCED_DETAIL_THRESHOLD = 40`. `reducedDetail = size < 40`.
- Below 40 (the 34px thumbnails) we drop layers that are physically sub-pixel at
  that scale and thus invisible: `TextureLayer` (weave), `ClothFoldLayer`,
  `PanelVolume` fine fold strokes, basketball channels/side-stitches, and the
  lettering's embellishment twill passes (full 10-pass `EmbroideredLabel` ->
  3 passes: depth shadow + outline + fill). Saves ~18-352 nodes/jersey depending
  on sport, with zero visible change.
- At size >= 40 (the 46 and 60 paths) every jersey renders the full detail set —
  byte-for-byte the original render. This is enforced by an `else`/guard branch,
  not a separate code path, so large jerseys are untouched.

## Lighting model (what makes them read as 3D)
- Body: 5-stop linear gradient, light on shoulders -> dark at hem.
- `volume`: radial highlight top-center.
- `edge`: left/right rim AO + center lift.
- `sheen` (run 1): diagonal specular band raking shoulder->chest.
- Baked drop shadow + contact ellipse under the hem.
- Lettering: twill outline + emboss + stitch-dash, locked into the cloth surface.
  Full 10-pass twill at size >= 40; 3-pass (depth+outline+fill) at thumbnail size
  where the embellishment passes are sub-pixel (run 2).
- Collars: all 9 sports now have a modeled neck with opening depth — soccer/ucl
  upgraded from a flat arc to a ribbed crew (inner shadow + fold highlight + seam)
  in run 2.
