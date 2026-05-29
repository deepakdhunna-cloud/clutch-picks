# Clutch Picks — Layout & Typography Changelog

> Per-batch before/after ledger. Values are the ACTUAL characters/numbers changed.
> Each change is gated against tokens.md §7 (the locked canon) before it ships.

---

## 2026-05-29 — PHASE 1, Batch 1: formatter-source character-level fixes

Scope: src/lib text-composition helpers ONLY (12-file allowlist). No screens/components
touched (those are Phase 3). No theme.ts / tailwind.config.js (Phase 2). No git.

Canon enforced: tokens.md §7f — numeric ranges → en-dash `–`; compact-meta separator → `·`.

### display-confidence.ts — tier-range hyphen → en-dash (CONFIDENCE_TIER_DEFINITIONS)
Source of truth read by PredictionBadge, confidence-explained, confidence-tiers,
search-explore, search, clutch-picks, game/[id]. Fixing here propagates everywhere.

| line | before | after |
|---|---|---|
| 96  | `range: '53-59%',` | `range: '53–59%',` |
| 103 | `range: '60-66%',` | `range: '60–66%',` |
| 110 | `range: '67-74%',` | `range: '67–74%',` |

Glyph: U+2013 EN DASH (verified `e2 80 93`). File remains UTF-8.
Safety: `confidence-explained.tsx` THREE_WAY_TIER_DEFINITIONS keys off `tier.label`,
not `tier.range` (it overwrites the range string), so no logic depends on the glyph.
onboarding.tsx:483-485 already used en-dash — this fix makes the SOURCE match the
already-correct screen, removing the documented audit-HIGH-#1 drift.

### stored-pregame-display.ts — spaced-hyphen ` - ` → middot ` · ` (compact meta subtitles)
Both strings surface via formatAnalysisLinkSubtitle as the analysis-link subtitle
(game/[id].tsx:1712 predictionContextSubtitle) — compact meta rows, so `·` per canon
(not `—`, which is reserved for sentence asides).

| line | before | after |
|---|---|---|
| 509 | `` `${factors.length} factors - ${edgeCount} edges identified` `` | `` `${factors.length} factors · ${edgeCount} edges identified` `` |
| 513 | `` `Pregame snapshot - ${Math.round(...)}% lean` `` | `` `Pregame snapshot · ${Math.round(...)}% lean` `` |

Glyph: U+00B7 MIDDLE DOT (verified `c2 b7`). File remains UTF-8.
NOTE: cricket-score.ts:63/65 ` - ` are SCORE lines (away - home), NOT meta separators —
left untouched per audit (a score range, not a label separator).

### src/lib/__tests__/stored-pregame-display.test.ts — lockstep test assertion update
NOT one of the 12 formatter files, but its assertion pinned the exact pre-fix string.
Updated the expectation glyph in lockstep so the suite stays green. No meaning change.

| line | before | after |
|---|---|---|
| 191 | `.toBe('Pregame snapshot - 53% lean')` | `.toBe('Pregame snapshot · 53% lean')` |

### Verification
- Mobile typecheck `tsc --noEmit -p tsconfig.app.json`: PASS (0 errors).
  (Root `tsc` shows 56 errors, ALL in backend/ from pre-existing `bun:test`/`Bun`
  globals — unrelated to this run; mobile src/ = 0 errors.)
- Formatter tests: stored-pregame-display (5), display-confidence (n), cricket-score (n),
  model-calibration-display (n) — all PASS (28 total).
- Glyph codepoints + UTF-8 confirmed via hexdump.

### Left untouched (already canon-compliant in these 12 files)
- prediction-display.ts: `Toss-Up`, `No Pick`, `TOSS-UP` already Title Case canon. CLEAN.
- projection-display.ts: `Toss-Up`, `Draw` canon; separators already `·`. CLEAN.
- narrative-display.ts: regex `don['’]t sleep` — DELIBERATE matcher accepting BOTH
  straight+curly apostrophes from upstream model output. NOT user-facing copy; changing
  it would reduce match robustness. LEFT, by design.
- No literal `...` ellipsis in any of the 12 files (all `...` are JS spread). The
  ellipsis canon affects screens only → Phase 3.
- decision-profile, model-calibration, pick-resolution, tonight-narrative,
  signature-calls, game-start-label: no canon defects. CLEAN.

---

## 2026-05-29 — PHASE 3, Batch 1 (priority): Live card column alignment + rank orphan

Trigger: Deepak flagged the Home "Live Now" card — jersey/name/rank "cramped and not
centered." Surface: `src/components/sports/LiveArenaCard.tsx` (`renderTeam`, shared by
the `rail` variant used by CompactLiveCard on Home AND the `full` variant in My Arena).

Diagnosis (geometry, not vibes): at cardWidth=300 (rail), teamColumnWidth ≈ 61.5px.
The record/rank Text had NO textAlign (defaulted left → misaligned vs the centered
name) and NO line/fit guard, so "ATP Rank #16" (~70px at 10px bold) wrapped and
stranded "#16" as an orphan. marginTop values (name 5, record 3) were off the 4pt grid.

| element | prop | before | after | why |
|---|---|---|---|---|
| record/rank Text | textAlign | (none → left) | `center` | match the centered name; fixes "not centered" |
| record/rank Text | numberOfLines | (none) | `1` | one clean line — kills the "#16" orphan |
| record/rank Text | adjustsFontSizeToFit | (none) | `true` + `minimumFontScale 0.75` | full text fits the 61.5px column; never abbreviates/clips the rank |
| record/rank Text | alignSelf | (none) | `stretch` | gives the fit a full-column width to center within |
| record/rank Text | marginTop | `3` | `4` (space.xs) | snap to 4pt grid |
| name Text | marginTop | `5` | `8` (space.sm) | snap to grid + breathing room (de-cramp) |

Gate: ✅ more consistent + canon-aligned (4pt grid), ✅ no wording change, ✅ no card
reflow (innerHeight is fixed at 160; record going 1-line for tennis frees vertical
space, so the card cannot grow/shift), ✅ in-lane (alignment/wrapping/rhythm), ✅ honors
the no-abbreviation rule (auto-fit shrinks text, never abbreviates). QUEUE.

Verification: `tsc --noEmit -p tsconfig.app.json` → PASS (0 errors).

NEEDS DEEPAK'S ON-DEVICE EYE:
- Confirm "ATP Rank #16/#21" and "WTA Rank #78" now sit on ONE centered line under each
  player, and that auto-fit text isn't too small on the narrowest (tennis) columns.
- Non-tennis records ("38-19") are short and unaffected (no shrink).

---

## 2026-05-29 — PHASE 3, Batch 2: matchup-name rendering consistency (My Arena / search.tsx)

Trigger: Deepak flagged the My Arena "Upcoming Slate" — a doubles match
"Irina Khromacheva / Jakob Schnaitter vs Giuliana Olmos / Austin Krajicek" was
crushed onto ONE line and auto-shrunk to ~10px, looking tiny/broken next to the big
15px singles names. Defect class: long matchup names forced to numberOfLines={1} with
adjustsFontSizeToFit → extreme shrink instead of a clean 2-line wrap at a readable,
consistent size. (Same disease family as the Live-card rank orphan, different surface.)

| line | element | before | after | why |
|---|---|---|---|---|
| 2130 | HorizonCard title (Game Day / Upcoming Slate) | `numberOfLines={1}` | `numberOfLines={2}` | doubles wrap to 2 readable lines (~13–15px) breaking cleanly at "vs"; singles unchanged (1 line @15px); card minHeight 96 already has room → NO growth/shift |
| 2400 | Prep "Ranked" card title | `numberOfLines={1}` | `numberOfLines={2}` | same fix for consistency across My Arena tabs |

Gate: ✅ consistent + readable, ✅ no wording change, ✅ NEVER abbreviates/clips a name
(honors §7g), ✅ no card reflow (minHeight has slack), ✅ in-lane (wrapping). QUEUE.
Verification: `tsc --noEmit -p tsconfig.app.json` → PASS.

Already-correct (left alone): line 3002 (Review tab) — already `numberOfLines={2}` + full names.

### ⚠️ JUDGMENT CALL FLAGGED (NOT changed — needs Deepak)
- **search.tsx:2810** — the compact 156px "upset" rail card renders
  `awayTeam.abbreviation vs homeTeam.abbreviation` (ABBREVIATED team names). This breaks
  the no-abbreviation rule (§7g), BUT a 156px card cannot fit full tennis-doubles names
  in 2 lines without shrinking tiny or growing the card. Deepak must choose: (a) full
  names + let the card grow/wrap, (b) full names + gentle shrink, (c) keep abbreviations
  as an accepted exception for this one compact card. LEFT as-is pending his call.

### NEXT: app-wide sweep of this defect class (all OTHER files; search.tsx + LiveArenaCard done)

---

## 2026-05-29 — PHASE 3, Batch 3: app-wide name-rendering sweep

Scope: the SINGLE defect class — team/player/matchup NAME render tiny-shrink / clip /
abbreviation, app-wide. Canon: §7g (names NEVER abbreviated; solve overflow by wrap/fit,
never clip; no reflow that breaks a fixed-height container). EXCLUDED per brief:
search.tsx (done: 2130/2400; 2810 flagged), LiveArenaCard.tsx (done), jersey nameplate
(jersey-artist lane). No git.

Standard applied (matches search.tsx:2130/2400 + GameCard:1057 + PickConfirmationModal:290):
long names WRAP to 2 lines at a readable, consistent size; `adjustsFontSizeToFit` kept
only as a gentle safety floor. NEVER abbreviate, NEVER clip.

### FIXES (6 sites, 4 files) — each: clip-risk / tiny-shrink → clean 2-line wrap

| file:line | element | before | after | why |
|---|---|---|---|---|
| game/[id].tsx:1785 | main matchup header — homeTeam.name | `numberOfLines={1}` (+fit 0.74) | `numberOfLines={2}` (fit kept as floor) | primary game-detail name was crushing to ~12px for long/doubles names; row (`teamNamesRow`) + parent are content-height, no fixed height → 2-line wrap is safe, reads at full 16px |
| game/[id].tsx:1789 | main matchup header — awayTeam.name | `numberOfLines={1}` (+fit 0.74) | `numberOfLines={2}` (fit kept as floor) | same; mirror of home cell |
| GameCard.tsx:487 | LIVE-row away team name | `numberOfLines={1}` (NO fit) | `numberOfLines={2}` + `adjustsFontSizeToFit minimumFontScale={0.8}` | clip-risk (1 line, no fit → "…" on long names); now matches the upcoming-card sibling at 1057; live row container is `padding:14`, no fixed height |
| GameCard.tsx:540 | LIVE-row home team name | `numberOfLines={1}` (NO fit) | `numberOfLines={2}` + `adjustsFontSizeToFit minimumFontScale={0.8}` | same; mirror of away row |
| picks-history.tsx:139 | pick team name (item.teamName, full name) | `numberOfLines={1}` (+fit 0.8) | `numberOfLines={2}` (fit kept as floor) | tiny-shrink; `pickCardInner` is content-height (no fixed height), name shares row with sport pill (alignItems center) → 2-line wrap safe |
| profile.tsx:288 | Signature-call matchup meta line (full names + sport + date) | `numberOfLines={1}` (+fit 0.8) | `numberOfLines={2}` (fit kept as floor) | leads with full names (line 275-276 prefer game.*.name); card `padding:16`, no fixed height; 2 lines beats crushing to ~9.6px |
| user/[id].tsx:74 | public-pick matchup `{away} @ {home}` | `numberOfLines={1}` (NO fit) | `numberOfLines={2}` | clip-risk; card padding 12, no fixed height; names must not clip (§7g) |
| game-analysis.tsx:430 | header subtitle `{home} vs {away} · pick, projection, and key factors` | `numberOfLines={1}` | `numberOfLines={2}` | names led a 1-line subtitle that would clip long/doubles names; header is content-height (paddingVertical 16) → 2-line subtitle safe |

Gate (all 6 changes): ✅ more consistent + readable, ✅ NEVER abbreviates/clips a name
(§7g), ✅ no off-scale magic number introduced, ✅ no fixed-height container forced to
overflow (every fixed-height/compact site was FLAGGED instead, see below), ✅ in-lane
(wrap/fit only). QUEUE.

Verification: `bunx tsc --noEmit -p tsconfig.app.json` → EXIT 0, 0 errors.

### ALREADY-CORRECT (left alone — already on the 2-line standard or not a name)
- GameCard.tsx:1057 / :1120 — upcoming-card names already `numberOfLines={2}` + fit. CLEAN.
- PickConfirmationModal.tsx:290 — `numberOfLines={2}` + fit. CLEAN.
- MLBLiveState.tsx:362 — jersey player name already `numberOfLines={2}` + fit. CLEAN.
- search-explore.tsx:192 / :215 / :409 — names already `numberOfLines={2}`. CLEAN.
- index.tsx:718/735 + clutch-picks.tsx:492/523 — full names, single-line BUT each in a
  `flexShrink:1`/`flex:1` column with default tail-ellipsis and no abbreviation; these
  are short-team-name rows (NBA-style). Default ellipsis acceptable; left as-is (not the
  tiny-shrink/abbrev defect). On-device eye flagged below.
- index.tsx:580/592 + clutch-picks.tsx:580/592 + game/[id].tsx:1010/1012 +
  game-analysis.tsx:481/483/497/503 — `.abbreviation` in WIN-PROBABILITY LEGEND rows
  ("ABBR 62%") — these are stat-legend labels paired with a % value, NOT the primary
  matchup name render (the full name shows elsewhere on the same surface). Not §7g
  violations. LEFT.
- MLBLiveState.tsx:159/176 — `styles.playerName` (no guard) renders short MLB names /
  "—" placeholder; no clipping container, low risk. LEFT.
- All `.abbreviation` used for getTeamColors / JerseyIcon teamCode / TeamJersey props /
  search haystacks / telemetry / navigation params — NOT user-facing name text. LEFT.

### ⚠️ JUDGMENT CALLS FLAGGED (NOT changed — need Deepak; same class as search.tsx:2810)
- **search-explore.tsx:291 / :312** — full team names at 15px, `numberOfLines={1}` +
  `minimumFontScale={0.8}`, INSIDE a Pressable with FIXED `height: RESULT_ROW_HEIGHT`
  (=98, line 256). The names share the row with a center score column (~per-name column
  ~130px) and a city subline below each name. A 2-line wrap would overflow the fixed 98px
  row (and would wrap MANY names, not just doubles). Forcing it breaks the row height
  (no slack). Options: (a) raise/remove RESULT_ROW_HEIGHT so 2-line names fit (needs
  layout owner sign-off), (b) drop the city subline to free vertical room for a 2-line
  name, (c) accept the tiny-shrink floor (status quo) as the lesser evil for this
  fixed-height results list. LEFT pending Deepak.
- **profile.tsx:525 / :526** — the 124×140 FIXED pick tile renders `pick.abbreviation`
  (525) and `vs {pick.opponentAbbr}` (526) — ABBREVIATED names (§7g violation). Direct
  sibling of search.tsx:2810: a 124px tile cannot fit a full team name without crushing
  tiny or growing the fixed tile. Options: (a) full names + let tile grow/wrap (changes
  the rail card geometry), (b) full names + heavy shrink (looks tiny), (c) keep
  abbreviation as an accepted exception for this compact rail tile. LEFT pending Deepak.
- **confidence-explained.tsx:138** — matchup subtitle `{awayAbbr} vs {homeAbbr}` uses
  ABBREVIATIONS, but this screen ONLY receives `homeAbbr`/`awayAbbr` via route params
  (lines 102-103); full names are NOT plumbed here. Switching to full names requires a
  cross-screen change: every caller (clutch-picks confidenceParams, game/[id], GameCard)
  must pass full names through navigation params — that's data-plumbing across multiple
  files, not a pure name-render edit, and out of this batch's lane. Options: (a) plumb
  full names through `ConfidenceParams` from all callers (multi-file, coordinate w/
  finisher), (b) accept abbreviations on this compact explainer subtitle. LEFT pending
  Deepak. (Legend rows :160/:164 are stat rows — not in scope.)

### ON-DEVICE EYE NEEDED (wrap point / size confirmation)
- game/[id].tsx:1783-1791 — confirm a long DOUBLES name now wraps to 2 clean lines under
  each cell (breaking at " / " or " vs ") and that the home/away cells stay balanced; the
  pre-game dim overlay is absolute over this row — confirm it still covers a now-taller
  2-line header.
- GameCard.tsx:487/540 (LIVE rows) — confirm a 2-line name doesn't visually collide with
  the right-aligned score; row grows gracefully (note: live-card vertical GROWTH as data
  updates = app-quality-engineer's shift lane, not mine).
- profile.tsx:288 — confirm the 2-line "name vs name · sport · date" meta line breaks
  cleanly (ideally after the matchup, before the · meta) and isn't lopsided.
- user/[id].tsx:74 — confirm `{away} @ {home}` wraps cleanly in the public-pick row.
