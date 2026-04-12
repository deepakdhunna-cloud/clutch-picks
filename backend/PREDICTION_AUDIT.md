# Prediction Engine Audit

Generated: 2026-04-12
Auditor: Claude (requested by Deepak)

---

## 1. Files Involved in Prediction Generation

| File | Role |
|------|------|
| `backend/src/lib/predictions.ts` (~2098 lines) | Main prediction engine: factors, weights, ensemble, confidence, narrative |
| `backend/src/lib/elo.ts` | Elo rating system: K-factors, home bonuses, MOV multiplier, DB persistence |
| `backend/src/lib/espnStats.ts` | Data fetching: recent form, extended stats, injuries, advanced metrics, lineups, weather, SRS |
| `backend/src/lib/mlbStatsApi.ts` | MLB starting pitcher quality scores (ERA, FIP, WHIP) |
| `backend/src/lib/backtesting.ts` | Accuracy evaluation: Brier score, log loss, confidence bucket calibration |
| `backend/src/lib/resolve-picks.ts` | Pick resolution against final scores |
| `backend/src/routes/games.ts` | Live game predictions, score-implied probability, pregame/live blending |
| `backend/src/routes/historical-backtest.ts` | Historical backtest route |
| `backend/src/routes/backtest.ts` | Backtest route |
| `backend/prisma/schema.prisma` | Database schema (TeamEloRating model exists) |

---

## 2. Hard-Coded Constants in Probability Math

### Sport Calibration (predictions.ts:16-25)
```
NBA:   { dampener: 0.85, ceiling: 88, tossUpCeiling: 57 }
NFL:   { dampener: 0.70, ceiling: 82, tossUpCeiling: 56 }
NCAAF: { dampener: 0.75, ceiling: 85, tossUpCeiling: 56 }
NCAAB: { dampener: 0.80, ceiling: 87, tossUpCeiling: 57 }
MLB:   { dampener: 0.78, ceiling: 75, tossUpCeiling: 53 }
NHL:   { dampener: 0.70, ceiling: 80, tossUpCeiling: 57 }
MLS:   { dampener: 0.75, ceiling: 78, tossUpCeiling: 53 }
EPL:   { dampener: 0.70, ceiling: 82, tossUpCeiling: 56 }
```
**Purpose:** Artificial confidence ceilings and power-curve dampeners. These are the primary confidence-theater constants.

### Sigmoid Scaling (predictions.ts:48-57)
```
NBA: 4.8, NCAAB: 4.5, NFL: 3.5, NCAAF: 4.0, MLB: 2.8, NHL: 3.0, MLS: 3.0, EPL: 3.2
```
**Purpose:** Controls sigmoid curve steepness for converting composite factor differential to win probability. These are tuning scalars with no cited empirical basis.

### Elo K-Factors (elo.ts:16-25)
```
NBA: 20, NFL: 32, NCAAF: 30, NCAAB: 22, MLB: 8, NHL: 12, MLS: 20, EPL: 20
```
**Purpose:** Controls how much each game moves ratings. These are reasonable and roughly aligned with published values.

### Elo Home Bonuses (elo.ts:28-37)
```
NBA: 100, NCAAB: 120, NFL: 48, NCAAF: 55, MLB: 24, NHL: 33, MLS: 55, EPL: 40
```
**Purpose:** Home-field advantage in Elo points.

### MOV Caps (elo.ts:41-50)
```
NBA: 2.0, NCAAB: 2.0, NFL: 2.5, NCAAF: 2.5, MLB: 1.8, NHL: 1.8, MLS: 2.0, EPL: 2.0
```
**Purpose:** Caps margin-of-victory multiplier to prevent blowout over-correction.

### Point Differential Normalization Scales (predictions.ts:577-590)
```
NFL: 10, NCAAF: 14, NBA: 12, NCAAB: 10, MLB: 1.2, NHL: 0.8, MLS: 0.6, EPL: 0.6
```
**Purpose:** Normalizes raw point differentials to [-1, 1] range for factor scoring.

### Factor Multipliers (scattered through predictions.ts)
- Win% differential: `× 2.5` (line 1300) — arbitrary scaling
- Recent form: `× 2` (line 1069) — arbitrary scaling
- H2H: `× 2` (line 1437) — arbitrary scaling
- Strength of Schedule: `× 4` (line 1476-1477) — arbitrary scaling

### Ensemble Weights (predictions.ts:1080-1089)
```
NBA:   { composite: 0.55, elo: 0.25, form: 0.20 }
NFL:   { composite: 0.50, elo: 0.20, form: 0.30 }
NCAAF: { composite: 0.50, elo: 0.25, form: 0.25 }
...
```
**Purpose:** 3-model ensemble blending. No cited basis.

### Position Weight Multipliers (predictions.ts:841-846)
```
NBA:  { PG: 1.5, SG: 1.2, SF: 1.4, PF: 1.1, C: 1.0, G: 1.3, F: 1.2 }
NFL:  { QB: 2.8, WR: 1.0, RB: 0.85, TE: 0.9, OL: 0.75, CB: 1.1, DE: 1.0, LB: 0.9, S: 0.8 }
MLB:  { SP: 2.5, C: 0.9, SS: 0.95, '2B': 0.8, '3B': 0.85, OF: 0.8, RP: 0.5 }
NHL:  { G: 2.5, D: 1.1, LW: 0.9, RW: 0.9, C: 1.1 }
```
**Purpose:** Scales injury impact by position importance. Reasonable but uncited.

### Live Game Constants (games.ts)
- Pace scales: `NBA: 2.3, NFL: 0.55, NHL: 0.05, NCAAB: 1.6, NCAAF: 0.60, MLB: 0.06, MLS: 0.033, EPL: 0.033`
- Live sigmoid: `× 1.5` (games.ts:366)
- Progress exponent: `0.7` (games.ts:367)

---

## 3. Probability/Confidence Clamps (Math.max / Math.min)

| Location | Code | Issue |
|----------|------|-------|
| predictions.ts:1916-1917 | `clamp(Math.round(calibratedWinnerProb), 50, cal.ceiling)` | Ceiling at 75-88 per sport |
| predictions.ts:1980-1984 | `clamp(50 + (postEnsembleConf - 50) * retention, 50, ceiling)` | Floor at 50, ceiling per sport |
| predictions.ts:1934 | `coverageMultiplier = Math.max(0.75, dataCoverage)` | Floor of 0.75 on coverage penalty |
| predictions.ts:1991 | `clamp(homeWinProbability / 100, 0.05, 0.95)` | Spread prob clamped 5-95% |
| predictions.ts:1881 | `Math.min(0.35, Math.max(0.05, drawProb))` | Draw probability floored at 5%, capped at 35% |
| predictions.ts:1036-1037 | `clamp(Math.round(rawConf), 50, 80)` | Elo sub-model capped at 80 |
| predictions.ts:1076 | `clamp(Math.round(rawConf), 50, 80)` | Form sub-model capped at 80 |
| games.ts:369 | `Math.max(0.05, Math.min(0.95, homeWinProb))` | **Live prob hard-clamped 5-95%** |
| games.ts:444 | `Math.max(50, Math.min(95, newWinnerProb))` | **Live confidence clamped 50-95** |

### Power-Curve Dampening (predictions.ts:1912-1914)
```ts
const deviation = winnerProb - 50;
const curvedDeviation = Math.pow(Math.abs(deviation), 0.85) * cal.dampener;
const calibratedWinnerProb = 50 + (deviation >= 0 ? curvedDeviation : -curvedDeviation);
```
**This is the main confidence compression step.** Exponent 0.85 + per-sport dampener (0.70-0.85) together compress all outputs toward 50%.

---

## 4. Narrative/Analysis Text Generation

### Template (predictions.ts:204-406)
- `buildTemplateAnalysis()` — deterministic fallback
- Reads from factor data, team records, injuries, rest, form
- 2-3 paragraphs, 80-130 words (recently tightened)
- Uses gameId hash for opening variety (5 patterns)

### AI (predictions.ts:530-598)
- `generateAIAnalysis()` — calls GPT-4o-mini
- Builds a user prompt with context sections (Elo, rest, injuries, H2H, trends, splits, lineup, weather, situational)
- System prompt constrains to 80-130 words
- Falls back to `buildTemplateAnalysis()` on failure
- **The LLM has access to the raw factor data but is NOT constrained to lead with top factors**
- AI agreement check: `checkAIAgreement()` scans text for team names to infer if AI agrees with model pick

---

## 5. Artifacts of Previously Reverted Manipulation

### Active concerns:
- **"noise floor"** comment at predictions.ts:47 — describes sigmoid scaling as reflecting "noise floor"
- **"floor"** at predictions.ts:1244 — season dampening: `Floor of 0.7 instead of 0.6`
- **"floor"** at predictions.ts:1881 — draw probability `floor 5%, cap 35%`
- **"floor"** at predictions.ts:1934 — coverage multiplier: `higher floor of 0.6`
- **"conservativeFloor"** at predictions.ts:1964 — ensemble blending creates an artificial floor
- **"boost"** comment at games.ts:401 — `confidence is boosted` when live score matches pregame pick
- **Clamp 0.05-0.95** at games.ts:369 and predictions.ts:1991 — hard probability range

### Mobile app flagged strings:
- `src/hooks/useGames.ts:284` — comment: "guaranteed predictions"
- `src/app/confidence-tiers.tsx:135` — disclaimer text mentions "guaranteed outcomes" (acceptable — it's a disclaimer)
- `src/app/(tabs)/clutch-picks.tsx:426` — comment: "guaranteed predictions from dedicated endpoint"

### Not found (good):
- No `minimum 0.52`, `minimum 52`, or explicit confidence floors above 50 in current code
- No `perfect pick` or `can't lose` strings
- The 50% floor is the natural one (predictions.ts:1916)

---

## Summary

The current engine has **three layers of confidence compression**:
1. **Sigmoid scaling** with per-sport tuning scalars (2.8-4.8) — no cited basis
2. **Power-curve dampening** (exponent 0.85 × dampener 0.70-0.85) — compresses toward 50%
3. **Hard ceilings** per sport (75-88) — artificial caps

Plus **arbitrary factor multipliers** (×2, ×2.5, ×4) and an **ensemble disagreement penalty** up to -15 points. The net effect is that the model rarely outputs above 72% confidence regardless of how lopsided the matchup is, and true coin-flip games get inflated to look like slight edges via the 50% floor + ensemble blending.
