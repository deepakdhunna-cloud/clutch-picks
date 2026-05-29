# Clutch Picks — Token Ground Truth

> Phase 0 ledger. READ-ONLY recon run on 2026-05-29.
> Status: ✅ SIGNED OFF by Deepak 2026-05-29. Canonical set LOCKED — see Section 7.
> Fixing may proceed against the locked set in Section 7.

## 1. Where tokens actually live

| Concern | File | Status |
|---|---|---|
| Color + spacing + type scale constants | `/Users/deepakdhunna/clutch-picks/src/lib/theme.ts` | Colors used widely; `SPACING` + `TYPOGRAPHY` objects NEVER imported (dead) |
| Tailwind/NativeWind config | `/Users/deepakdhunna/clutch-picks/tailwind.config.js` | Defines its OWN `fontSize` scale that DISAGREES with theme.ts |
| className merge helper | `/Users/deepakdhunna/clutch-picks/src/lib/cn.ts` | fine |
| Team color map | `/Users/deepakdhunna/clutch-picks/src/lib/team-colors.ts` | jersey-artist lane, out of scope |

Key fact: `import { SPACING }` and `import { TYPOGRAPHY }` return **0 hits** outside
theme.ts itself. Only the COLOR constants (MAROON, TEAL, BG, GLASS_*, BORDER_*, etc.)
are imported. So the documented spacing + type tokens are aspirational, not enforced.

## 2. The two CONFLICTING type scales (must be reconciled)

theme.ts `TYPOGRAPHY` (px):
xs10 sm12 base14 md16 lg18 xl20 2xl24 3xl28 4xl32 5xl40 6xl48 display56 hero72

tailwind.config.js `fontSize` (px):
xs10 sm12 base14 lg18 xl20 2xl24 3xl32 4xl40 5xl48 6xl56 7xl64 8xl72 9xl80

Conflicts:
- `md:16` exists in theme, ABSENT in tailwind.
- `3xl` = 28 (theme) vs 32 (tailwind). `4xl` = 32 vs 40. `5xl` = 40 vs 48. `6xl` = 48 vs 56.
- tailwind has 7xl/8xl/9xl; theme has display/hero with different numbers.
Same names, different pixels = a guaranteed-drift trap if anyone keys off names.

## 3. Spacing scale ground truth

theme.ts `SPACING` (unused): xs4 sm8 md12 lg16 xl20 2xl24 3xl32 4xl40 5xl48 — a clean
4pt scale. But the app does NOT use it. Reality is **inline `style={{}}` raw numbers**.

Measured reality (1,924 inline numeric spacing props: padding*/margin*/gap*):
- 1,010 (52%) land on a 4pt grid; **914 (48%) are OFF a 4pt grid.**
- Only 555 (29%) are multiples of 8.
- Most common values: 8(228) 16(188) 10(160) 12(157) 4(131) 14(129) 6(123) 20(116)
  2(100) 5(86) 3(69) 24(55) 7(44) 18(39) 9(32) 32(32) 28(31) 11(25) — i.e. 10/14/6/5/3/7/9/11/18 (all off-8, several off-4) are pervasive.

Tailwind spacing classes are sparse (~90 total uses) and mostly on-scale (mb-2, mb-4,
px-5, mb-3). The problem is the inline numbers, not the className spacing.

## 4. Type / letterSpacing / lineHeight reality

- Inline `fontSize`: 889 occurrences spanning nearly every integer 6→72. Heaviest:
  11(128) 10(128) 9(115) 12(90) 13(82) 8(58) 14(53) 16(41) 15(35). Odd sizes
  9/11/13/15/17 are extremely common and bypass any scale.
- Inline `letterSpacing`: 42 DISTINCT values (1.5, 0.5, 2, 1, 0, 0.3, 1.1, 1.2, -0.5,
  -0.3, 0.8, 1.4, 0.2, 2.2, 1.7 ... down to one-offs like 1.45, 0.95, -0.22, 24).
- Inline `lineHeight`: ~30 distinct values, mostly raw px not ratio-derived.

## 5. VERDICT

**NOT consistent, NOT complete enough to key the campaign off as-is.**
Reasons: (a) two name-colliding type scales that disagree; (b) the documented
SPACING/TYPOGRAPHY tokens are dead — never imported; (c) ~48% of real spacing is
off-grid; (d) fontSize/letterSpacing/lineHeight are free-for-all inline numbers.

The good news: theme.ts already contains a clean 4pt SPACING scale and a sane
TYPOGRAPHY ladder. We don't need to invent much — we need to (1) reconcile the two
type scales into one, (2) make the tokens the enforced source, (3) migrate inline
numbers onto the scale. Proposal below is intentionally minimal/conventional.

---

## 6. PROPOSED CANONICAL SET (for sign-off — DO NOT IMPLEMENT YET)

### 6a. Spacing — adopt theme.ts SPACING as-is (4pt grid). Add 2 missing rungs.
```
space.none  0
space.xs    4
space.sm    8
space.md    12
space.lg    16
space.xl    20
space.2xl   24
space.3xl   32
space.4xl   40
space.5xl   48
space.6xl   64   (NEW — for hero/section gaps already done ad hoc at 60/64)
```
Note 28 is dropped from the everyday rhythm (28 appears 31× but is non-4-friendly
next to 24/32; recommend snapping those to 24 or 32 case by case). The 6/10/14/18/22
family snaps DOWN/UP to the nearest rung at fix time (documented per-fix in changelog).

### 6b. Screen edge margin — ONE canonical value.
Reality today: screens use 16, 20, AND 24 as the outer horizontal padding; the
GlassBottomNav.SPEC.md already declares **20px** edge padding. Recommend canonical
**screen edge = 20 (space.xl)** to match the nav island, with 16 reserved for
in-card padding. (This is the single highest-leverage Phase-3 decision — needs
Deepak's eye, see audit.md "judgment calls".)

### 6c. Type scale — collapse to ONE ladder (reconcile theme.ts vs tailwind).
Recommend keeping theme.ts numbers (they better fit a dense sports UI) and aligning
tailwind.config.js fontSize to match. Proposed single ladder:
```
text.xs     10   (micro labels, badges)
text.sm     12   (captions, secondary)
text.base   14   (body)
text.md     16   (emphasized body / list titles)
text.lg     18   (card titles)
text.xl     20   (section headers)
text.2xl    24   (screen titles)
text.3xl    28   (large headers)
text.4xl    32
text.5xl    40
text.6xl    48
text.display 56
text.hero   72
```
The campaign would snap the pervasive 9/11/13/15/17 inline sizes to the nearest rung
(9→10, 11→12 or 10, 13→14 or 12, 15→16 or 14, 17→16 or 18) — each a per-fix judgment,
logged with before/after.

### 6d. letterSpacing — define ~5 named tokens; kill the 42-value sprawl.
```
tracking.tight   -0.3
tracking.normal   0
tracking.wide     0.5
tracking.wider    1.0
tracking.caps     1.5   (for ALL-CAPS labels/badges)
```

### 6e. lineHeight — define by ROLE (ratio-based), not raw px.
```
leading.tight   1.1   (display/hero)
leading.snug    1.25  (titles)
leading.normal  1.4   (body)
leading.relaxed 1.6   (long-form paragraphs / descriptions)
```

### 6f. Punctuation / text-format canon (Phase-1 enforcement, source-of-truth helpers)
- Ellipsis: use `…` (single glyph) everywhere, including loading/placeholder text.
- Range separator: en-dash `–` for numeric ranges (53–59%) — adopt EVERYWHERE
  (currently mixed hyphen `-` vs en-dash `–` for the SAME tier ranges).
- Label/meta separator: middot `·` (already dominant, 42 uses) OR em-dash `—` (310
  uses). Recommend `·` for compact meta rows, `—` for sentence asides. Kill the
  spaced-hyphen ` - ` separator in narrative text.
- Apostrophes/quotes in USER-FACING strings: pick ONE. Recommend straight `'` `"`
  (already dominant in signature-calls) for consistency with template interpolation.
- Casing canon for repeated labels: `Toss-Up`, `No Pick`, `View All` (Title Case),
  enforced from the formatter source (display-confidence.ts / prediction-display.ts).

---

## 7. ✅ SIGNED-OFF CANONICAL SET — LOCKED 2026-05-29

This is the authoritative set the campaign enforces. Supersedes any conflict above.

### 7a. Spacing — 4pt grid (theme.ts SPACING + new 6xl)
```
space.none 0   space.xs 4    space.sm 8    space.md 12   space.lg 16
space.xl 20    space.2xl 24  space.3xl 32  space.4xl 40  space.5xl 48  space.6xl 64 (NEW)
```
28 dropped from everyday rhythm (snap to 24/32 per-fix). 6/10/14/18/22 snap to nearest rung, logged per-fix.

### 7b. Screen edge — **20 (space.xl)** ✅ Deepak's call: "recommend for a professional app"
Canonical outer horizontal padding = 20 everywhere (matches GlassBottomNav island).
In-card padding = 16 (space.lg). This is the Phase-3 keystone.

### 7c. Type ladder — **theme.ts (denser)** ✅ Deepak delegated; chosen for dense sports UI + less reflow
```
text.xs 10  text.sm 12  text.base 14  text.md 16  text.lg 18  text.xl 20
text.2xl 24 text.3xl 28 text.4xl 32  text.5xl 40 text.6xl 48 text.display 56 text.hero 72
```
tailwind.config.js fontSize to be aligned to match (Phase 2). Snap inline 9/11/13/15/17 to nearest rung, preserving rendered size where possible (avoid reflow), logged per-fix.

### 7d. letterSpacing — 5 named tracking tokens
```
tracking.tight -0.3   tracking.normal 0   tracking.wide 0.5   tracking.wider 1.0   tracking.caps 1.5
```

### 7e. lineHeight — 4 role-based ratios
```
leading.tight 1.1   leading.snug 1.25   leading.normal 1.4   leading.relaxed 1.6
```

### 7f. Punctuation / text canon
- Ellipsis: `…` (single glyph) everywhere — including loading/placeholder text.
- Numeric range separator: en-dash `–` everywhere (e.g. `53–59%`).
- Label/meta separator: `·` for compact meta rows, `—` for sentence asides. Kill spaced-hyphen ` - `.
- **Quotes/apostrophes: CURLY `’ “ ”`** ✅ Deepak's call (premium look). ⚠️ REQUIRES on-device glyph verification on badges/buttons before global lock (J2/J3). Use correct directional glyphs: `’` for apostrophes/contractions, `“ ”` for quotation pairs.
- Casing canon for repeated labels: `Toss-Up`, `No Pick`, `View All` (Title Case), enforced at formatter source.

### 7g. Standing constraints (apply to ALL phases)
- **Team names are NEVER abbreviated.** Solve overflow via wrapping / text-fit / last-resort ellipsis — never abbreviation.
- No off-scale magic numbers; if a rung is missing, propose a token (don't scatter).
- No reflow/layout-break to chase polish; if a fix risks shift, flag for app-quality-engineer.
- Never change the MEANING/wording of copy — formatting/punctuation/casing/spacing only.
