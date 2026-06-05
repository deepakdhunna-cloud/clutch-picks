# Clutch Picks Prediction Engine — Comprehensive Analysis

## Executive Summary

After a thorough code review of the prediction engine (`backend/src/prediction/`), its backtest results, factor models, simulation layer, calibration system, and data pipelines, this report identifies the **structural flaws, data gaps, and algorithmic weaknesses** that limit accuracy across leagues. The engine currently achieves **61.1% overall accuracy** (270 games), with NBA at 66.7%, MLB at 63.3%, and NHL at a near-coin-flip 53.3%. Soccer leagues (EPL/MLS/UCL) and emerging sports (IPL, Tennis) face even steeper challenges due to missing core features.

The fundamental problem is not a single bug — it is an **architectural ceiling** created by the combination of (1) proxy-heavy feature engineering, (2) chronic data unavailability for the engine's own critical factors, (3) a heuristic-only model with no learned parameters, and (4) a validation framework that cannot distinguish real improvement from data leakage.

---

## Part 1: Structural & Architectural Flaws

### 1.1 The Engine Is a Heuristic Stack, Not a Learned Model

The entire prediction pipeline — from factor computation through simulation to final blending — is composed of **hand-tuned constants, linear translations, and rule-based thresholds**. There is no machine learning, no gradient-based optimization, and no parameter fitting against historical outcomes.

| Component | Nature | Problem |
|-----------|--------|---------|
| Factor weights (0.40 Elo, 0.10 form, etc.) | Hand-set | Never optimized against actual outcomes |
| Elo-to-probability conversion | Fixed logistic (400-pt scale) | No sport-specific calibration of the scale parameter |
| Simulation score model | Deterministic heuristics | 50,000 iterations of a model with no learned parameters adds precision without accuracy |
| Market blending weights | Per-sport constants | Tuned on n≈110 per league — far too small for reliable weight selection |
| Self-learning calibration | Bounded ±3pp nudge | Too conservative to fix systematic miscalibration |

The consequence is that **every coefficient in the system reflects a developer's judgment rather than a data-driven optimum**. When those judgments are wrong (as they inevitably are for some leagues), there is no mechanism to self-correct beyond the tiny ±3pp self-learning band.

### 1.2 Elo Dominance Creates a Single Point of Failure

The `rating_diff` factor commands **40% of the base weight** (0.40 out of 0.58 base budget), and after redistribution of unavailable sport-specific factors, it frequently absorbs 50-65% of the total model weight. This creates several problems:

1. **Stale Elo ratings** — The K-factors (NBA=20, MLB=8, NHL=12) mean ratings adapt slowly. A team that has improved dramatically mid-season (trades, injuries healing, coaching changes) carries a lagging Elo for weeks.

2. **Home-field bonus is static** — The engine adds a fixed home bonus (NBA=100, NFL=48, MLB=24, NHL=33 Elo points) regardless of context. Post-COVID research shows home advantage has declined significantly in most leagues, and it varies by venue, crowd size, and schedule context.

3. **No Elo history per game** — The calibration module explicitly warns about "historical Elo data leak" because the system cannot reconstruct what Elo a team had on a past game date. This makes proper backtesting impossible.

4. **Tennis has no real Elo pipeline** — The code explicitly acknowledges this: "Tennis has no real player-Elo pipeline, so this 40% factor is dead weight that dilutes the ATP/WTA ranking signal." The `ENGINE_TENNIS_RANK_RECLAIM` flag exists but defaults to OFF.

### 1.3 The "Full-Scale Rating" Fix Created New Problems

The `isFullScaleRatingEnabled()` flag (graduated to ON by default) was meant to fix under-confidence by entering Elo at full scale rather than weight-diluted. While it improved Brier scores, it introduced a new failure mode visible in the backtest:

> Multiple NBA high-confidence misses (77-81% confidence) where the engine predicted the home team with 4-5 unavailable factors. The full-scale Elo + 100-point NBA home bonus generated extreme confidence despite having almost no supporting evidence.

The "conflict-aware blend" mitigation (lines 1217-1225 of `index.ts`) only activates when other factors actively disagree — but when those factors are simply **missing**, the Elo base runs uncontested.

### 1.4 Weight Redistribution Amplifies the Wrong Signal

When sport-specific factors are unavailable (which happens frequently), `redistributeWeights()` proportionally scales up the remaining available factors. In practice, this almost always means **Elo absorbs the missing weight**, because:

- Elo (`rating_diff`) is always available (defaults to 1500 for new teams)
- Rest (`rest_diff`) is often available but has no signal (equal rest)
- Travel is always available but rarely has signal

The `applyLeagueReliabilityGuards()` function attempts to cap Elo's weight when critical factors are missing, but the caps (0.30-0.36 depending on sport) are still very high, and the redistributed excess often goes to factors with no directional signal.

---

## Part 2: Data Quality & Coverage Failures

### 2.1 The Engine Frequently Lacks Its Own Critical Inputs

The `predictionSourceCoverageAudit.ts` script defines per-sport "critical factors" that the engine itself considers essential. The backtest results show these are frequently missing:

| League | Critical Factors | Common Availability Issue |
|--------|-----------------|--------------------------|
| NBA | `injuries_nba`, `net_rating` | Net rating unavailable early season; injury reports unverified |
| NHL | `starting_goalie`, `special_teams`, `injuries_nhl` | No individual goalie stats — uses team SV% proxy |
| MLB | `starting_pitcher`, `injuries_mlb` | ESPN feed lacks innings pitched; position injuries sparse |
| EPL/MLS/UCL | `fixture_congestion`, `key_player_availability`, `stakes` | Congestion data often null; stakes only activate late season |
| Tennis | `tennis_ranking_edge`, `tennis_recent_form` | Form requires 3+ recent results; many players lack this |
| IPL | `ipl_table_strength`, `ipl_venue_split` | Venue split requires 3+ games at venue |

The high-confidence misses in the backtest almost universally carry warnings like:
- "Low factor coverage; missing inputs were redistributed before final aggregation."
- "Missing critical league inputs triggered a reliability reserve instead of amplifying rating/home-field."

**This is the single largest accuracy problem**: the engine generates confident predictions while missing the data it needs to be confident.

### 2.2 Proxy Features Are Weak Substitutes

Several "factors" are actually crude proxies for the real signal:

| Factor | What It Claims | What It Actually Uses | Signal Loss |
|--------|---------------|----------------------|-------------|
| NHL Starting Goalie (0.22 weight) | Individual starter quality | Team-level save percentage | Massive — backup vs starter is the real edge |
| NBA Injuries (0.19 weight) | Star player impact | Position-based fixed values (PG=60, SG=45, etc.) | High — Jokic OUT ≠ random center OUT |
| Recent Form (0.10 weight) | Opponent-adjusted momentum | Raw L10 win rate × 400 | Moderate — no opponent quality weighting |
| Travel (0.03 weight) | Jet lag / fatigue | Consecutive away games count | High — no actual distance/timezone data |
| Soccer Key Player (0.168 weight) | Star availability impact | Count of OUT players × 25 Elo | Extreme — all players weighted equally |

### 2.3 Critical Features Were Removed Without Replacement

The codebase contains explicit notes about removed features that were never replaced:

1. **xG (Expected Goals)** — Removed from soccer because "Understat and FBRef are both Cloudflare-blocked from Railway." This is the single most predictive feature in modern soccer analytics.

2. **3P Variance Regression (NBA)** — Removed because "stats.nba.com IP-blocks Railway/cloud hosts." Three-point shooting variance is a key predictor of NBA upset risk.

3. **Pitcher Handedness Matchup (MLB)** — Removed because "data too expensive to source reliably." Platoon splits are worth 2-4% win probability in MLB.

4. **Individual Goalie Stats (NHL)** — The code says "When individual goalie stats become available via the athlete endpoint, this can be upgraded" — but it never was.

---

## Part 3: League-Specific Problems

### 3.1 NHL (53.3% — Near Coin Flip)

NHL is the worst-performing league because:

1. **Goalie factor is broken** — The 0.22-weight "starting goalie" factor uses TEAM save percentage, not the actual confirmed starter. In a league where the backup-vs-starter gap is worth 5-8% win probability, this is catastrophic.

2. **Back-to-back assumption is crude** — A fixed -35 Elo penalty for any team on 0 rest days assumes they're starting a backup. Many teams start their #1 goalie on back-to-backs in critical games.

3. **Special teams calculation is wrong** — The formula `homePP - (1 - awayPK)` conflates power play opportunity rate with conversion rate. The actual predictive signal is PP goals/60 vs PK goals-against/60.

4. **Low K-factor (12) makes Elo sluggish** — NHL teams change dramatically through trades and injuries. A K of 12 means it takes 15-20 games for a major roster change to fully register.

### 3.2 Soccer — EPL/MLS/UCL (Structural Ceiling)

Soccer predictions face a **fundamental feature gap**:

1. **No xG or shot quality data** — The most predictive team-level feature in soccer is completely absent.
2. **Draw probability is formulaic** — `estimateDrawProbability()` uses a fixed base rate (24-25%) with a power-law closeness decay. Real draw probability depends on team styles, match context, and tactical setups.
3. **All players weighted equally in injury factor** — Losing a star striker vs. a backup fullback produces the same 25-Elo impact.
4. **Stakes factor only activates late season** — Motivation/context matters throughout the season (derbies, cup rotation, European fixture congestion).
5. **No tactical/style matching** — A defensive team vs. an attacking team has different draw probability than two attacking teams.

### 3.3 MLB (63.3% — Decent but Capped)

MLB performs best because starting pitcher data is the most available sport-specific signal, but:

1. **Missing innings pitched** — ESPN's probable pitcher feed often lacks IP, triggering a "70 IP prior" that dampens the signal for pitchers who actually have extensive track records.
2. **Bullpen fatigue is a proxy** — Uses "recent runs allowed" rather than actual bullpen usage (pitches thrown in last 3 days).
3. **No platoon splits** — Left-vs-right matchup data was removed.
4. **Park factors are static** — Uses 2023-2024 Baseball Savant data with no seasonal or weather adjustment.
5. **Market weight is 0.80** — The engine essentially defers to the betting line for MLB, which means it's not really "predicting" — it's reading the market with a small model overlay.

### 3.4 NBA (66.7% — Best but Fragile)

NBA is the strongest league but has a specific failure mode:

1. **Home bonus of 100 Elo is too high** — Post-2020 NBA home advantage is closer to 2.5 points (≈60 Elo), not 3.5+ points (100 Elo). This creates systematic home bias.
2. **Injury impact is position-based, not player-based** — The engine treats all PGs as worth 60 Elo. In reality, losing Luka Dončić is worth 200+ Elo while losing a backup PG is worth 10.
3. **No lineup/rotation data** — The engine doesn't know if a team is resting starters in a meaningless late-season game.
4. **Net rating is season-long** — No recency weighting means a team that was terrible for 60 games but excellent for the last 20 still carries the full-season average.

### 3.5 IPL (50% — Coin Flip)

IPL predictions are essentially random because:

1. **No toss data** — The toss winner in T20 cricket gains 5-8% win probability by choosing to bat/bowl based on conditions.
2. **No player-level data** — No individual batting/bowling averages, strike rates, or matchup data.
3. **No pitch/conditions model** — Different pitches (pace-friendly vs spin-friendly) dramatically change team strengths.
4. **Elo is meaningless for franchise cricket** — Teams change 30-50% of their squad every season through auctions.

### 3.6 Tennis (Structural Issues)

1. **No surface-specific performance** — A clay-court specialist vs. a grass-court specialist on clay is a massive edge not captured.
2. **No head-to-head history** — Tennis has extreme stylistic matchup effects.
3. **Elo is dead weight** — Acknowledged in code but the reclaim flag defaults to OFF.
4. **Ranking delta uses log scaling** — This compresses the difference between #1 vs #5 (small gap) and #50 vs #100 (large gap), when in reality the top-5 are much more dominant.

---

## Part 4: Calibration & Validation Flaws

### 4.1 The Backtest Framework Has Data Leakage

The `replayBacktest.ts` explicitly states:

> "Only Elo is point-in-time while injuries/form/standings are rebuilt from CURRENT data."

This means the reported accuracy improvements (old 54.2% → new 59.3%) are **contaminated by future information**. The engine is being validated with data it wouldn't have had at prediction time.

### 4.2 Confidence Is Miscalibrated

The calibration buckets from the historical replay show:

| Confidence Bucket | Games | Actual Accuracy | Gap |
|-------------------|-------|-----------------|-----|
| 50-54% | 81 | 51.9% | -0.6pp (good) |
| 55-59% | 70 | 57.1% | -0.4pp (good) |
| 60-64% | 36 | 58.3% | -3.7pp (overconfident) |
| 65-69% | 15 | 93.3% | +26.3pp (underconfident) |
| 70-74% | 15 | 86.7% | +14.2pp (underconfident) |
| 75-79% | 11 | 72.7% | -4.8pp (overconfident) |
| 80-100% | 7 | 71.4% | -13.6pp (overconfident) |

The pattern is clear: **the engine is overconfident at the extremes** (75%+ predictions win only 72%) and the middle buckets have too few samples to be statistically meaningful. The 65-69% bucket showing 93.3% accuracy on just 15 games is noise, not signal.

### 4.3 Self-Learning Calibration Is Too Weak

The self-learning layer caps adjustments at ±3pp (binary) or ±2pp (three-way), requires 30+ samples before activating, and blends at only 35% rate. Given the systematic miscalibration shown above (13.6pp gap at high confidence), a ±3pp cap cannot fix the problem.

### 4.4 Sample Sizes Are Inadequate for Validation

The backtest uses only 90 games per sport (270 total). At this sample size:
- A 5% accuracy difference is not statistically significant (p > 0.15)
- Per-sport confidence bucket analysis is meaningless (n=7-15 per bucket)
- The market weight "sweep" was done on n≈110 per league — far too small to distinguish 0.60 vs 0.80 weight

---

## Part 5: Blending & Orchestration Problems

### 5.1 Market Can Never Override the Model (By Design)

The `preserveNonMarketOutcome()` function ensures that market consensus can **never flip the model's pick**. The code comment explains:

> "By DEFAULT the factor/projection favorite is preserved — the market can only shrink or grow the gap, never flip the pick."

While there's an `ENGINE_MARKET_FLIP_MIN` threshold (default 0.52) that theoretically allows flips, the `resolveBlendOutcome()` logic is written so that when the market disagrees, it returns the blended probability **without** flipping — effectively neutering the market's ability to correct wrong model picks.

For MLB (where the market is the single best predictor), this means the engine can disagree with the betting line and stubbornly stick with its inferior model pick.

### 5.2 The Simulation Adds Complexity Without Accuracy

The 50,000-iteration Monte Carlo simulation is deterministic (seeded PRNG) and uses the same heuristic inputs as the factor model. It cannot discover information the factor model doesn't already have. Its contribution:

- **Projection weight is only 8-14%** — Too small to meaningfully move the pick
- **It uses the same score baselines** — `inferTeamAttack()` uses the same `avgScore`/`avgAllowed` data
- **It adds the same market anchor** — The simulation's margin/total anchoring duplicates what the blend already does

The simulation's real purpose appears to be generating projected scores for display, not improving pick accuracy.

### 5.3 Too Many Layers of Post-Processing

The prediction flows through:
1. Factor computation → 2. Weight redistribution → 3. Reliability guards → 4. Blend factors → 5. Sum rating delta → 6. Weak sport calibration → 7. Elo logistic → 8. Soccer draw adjustment → 9. Simulation → 10. Model/projection/market blend → 11. Outcome preservation → 12. Self-learning calibration → 13. Projection reconciliation → 14. Score quantization

Each layer adds complexity and potential for error without adding predictive signal. The system has become a **Rube Goldberg machine** where it's nearly impossible to trace why a specific prediction was made or to isolate which component is causing errors.

---

## Part 6: Recommendations for Improvement

### Tier 1: High-Impact, Achievable Now

| # | Recommendation | Expected Impact | Effort |
|---|---------------|-----------------|--------|
| 1 | **Enable `ENGINE_TENNIS_RANK_RECLAIM=true`** | Tennis accuracy +5-10% | Config change |
| 2 | **Reduce NBA home bonus from 100 to 65 Elo** | Fewer false home picks | Config change |
| 3 | **Allow market to flip picks when confident** | MLB/NHL accuracy +3-5% | Small code change |
| 4 | **Increase self-learning calibration cap to ±8pp** | Better extreme-confidence calibration | Small code change |
| 5 | **Add player-importance weighting to NBA injuries** | Fewer high-confidence misses | Moderate (need usage rate data) |
| 6 | **Source confirmed NHL starting goalie** | NHL accuracy +5-8% | API integration |
| 7 | **Suppress high confidence when critical factors missing** | Fewer embarrassing misses | Small code change — hard-cap confidence at 62% when >3 factors unavailable |

### Tier 2: Medium-Impact, Requires New Data Sources

| # | Recommendation | Expected Impact | Effort |
|---|---------------|-----------------|--------|
| 8 | **Add xG data for soccer** (via API proxy or paid source) | Soccer accuracy +8-12% | API integration + proxy |
| 9 | **Add surface-specific tennis ratings** | Tennis accuracy +5-8% | Data pipeline |
| 10 | **Add recency-weighted net rating for NBA** (last 15 games) | NBA accuracy +2-3% | Computation change |
| 11 | **Add actual bullpen usage data for MLB** | MLB accuracy +1-2% | API integration |
| 12 | **Add toss result for IPL** (live, post-toss prediction) | IPL accuracy +5-8% | Live data feed |
| 13 | **Store point-in-time Elo per game** | Enables proper backtesting | Schema + migration |
| 14 | **Add player-level WAR/VORP for injury impact** | All leagues +2-4% | Data pipeline |

### Tier 3: Architectural Changes for Long-Term Accuracy

| # | Recommendation | Expected Impact | Effort |
|---|---------------|-----------------|--------|
| 15 | **Replace hand-tuned weights with logistic regression** | All leagues +3-7% | Major refactor |
| 16 | **Train per-sport models on historical outcomes** | Optimal weight discovery | ML pipeline |
| 17 | **Implement proper point-in-time backtesting** | Honest validation, no data leakage | Infrastructure |
| 18 | **Add ensemble disagreement as a confidence signal** | Better calibration | Moderate |
| 19 | **Implement dynamic home advantage** (declining trend, venue-specific) | Fewer home bias errors | Research + implementation |
| 20 | **Separate "pick accuracy" from "projection accuracy"** | Focus optimization on the right metric | Architecture |

### Tier 4: Fundamental Model Redesign

| # | Recommendation | Expected Impact | Effort |
|---|---------------|-----------------|--------|
| 21 | **Build a proper feature store with historical snapshots** | Enables ML training | Major infrastructure |
| 22 | **Implement gradient-boosted model (XGBoost/LightGBM) per sport** | State-of-art accuracy | ML engineering |
| 23 | **Add closing line value (CLV) tracking** | Measures true edge vs market | Data pipeline |
| 24 | **Implement Bayesian updating for live Elo** | Faster adaptation to roster changes | Algorithm redesign |

---

## Part 7: Root Cause Summary

The prediction engine's accuracy problems stem from **five root causes**, listed in order of impact:

1. **Data starvation** — The engine's own critical factors are frequently unavailable, forcing it to fall back on Elo + home field, which is insufficient for confident predictions.

2. **No learned parameters** — Every weight, threshold, and conversion factor is hand-tuned. Without optimization against outcomes, the engine cannot discover the true predictive relationships in each sport.

3. **Proxy features** — The most important sport-specific signals (NHL starter, NBA player value, soccer xG) are approximated with weak proxies that carry a fraction of the true signal.

4. **Overconfidence without evidence** — The full-scale Elo + large home bonuses generate 70-80% confidence predictions even when most sport-specific factors are missing. The reliability guards are too permissive.

5. **Contaminated validation** — The backtest framework uses current data for historical games, making it impossible to know whether changes actually improve real-time prediction accuracy.

---

## Conclusion

The Clutch Picks prediction engine is an impressive piece of engineering in terms of its architecture, transparency, and coverage of multiple sports. However, it has reached the **accuracy ceiling of a heuristic-only approach**. The path to meaningfully better predictions requires:

1. **Immediate**: Fix the confidence calibration and data-gating problems (Tier 1 recommendations)
2. **Short-term**: Fill the critical data gaps that make the engine blind (Tier 2)
3. **Medium-term**: Replace hand-tuned weights with learned parameters (Tier 3)
4. **Long-term**: Build a proper ML pipeline with point-in-time features (Tier 4)

The current 61% overall accuracy is roughly what you'd expect from a well-calibrated Elo model with home-field advantage — which is essentially what the engine reduces to when its sport-specific factors are unavailable. To break through 65% consistently across leagues, the engine needs real predictive features, not more heuristic layers on top of the same thin data.
