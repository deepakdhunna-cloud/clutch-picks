# Prediction Engine — Unified Simulation Architecture (v3.0)

`predictGame(ctx)` is the single pregame engine entry point. It computes all
matchup factors, feeds them into a league-specific Monte Carlo simulation that
produces **both** the win probability **and** the projected scores in a single
coherent pass, then applies optional market calibration as a post-processing
step. The result is one `canonicalResult` where the probability and the
projected score line always agree because they came from the same simulation.

The canonical object lives on `HonestPrediction.canonicalResult` and is carried
through the API as `GamePrediction.canonicalResult`. UI surfaces must read the
final pick, final probability, confidence, and win-probability display from
that object. Legacy fields such as `predictedWinner`, `confidence`,
`homeWinProbability`, and `projection.*WinProbability` are mirrored for older
components, but they are not the source of truth.

## Unified Engine Flow

```
Factors → Rating Delta → Monte Carlo Simulation → Probability + Scores
                                                         ↓
                                               Market Calibration (optional)
                                                         ↓
                                               Thin-Data Confidence Cap
                                                         ↓
                                               Final Canonical Result
```

1. **Compute all factors** — base factors (Elo, home advantage, form, injuries,
   rest) plus sport-specific factors (pitcher matchups, goalie stats, xG, surface
   ratings, special teams, etc.)
2. **Redistribute weights** — missing factors reduce confidence rather than
   inflating Elo; rating_diff is capped at 0.55 max effective weight
3. **Sum factor deltas** into a total rating advantage (Elo points)
4. **Run the unified simulation** — 50,000 deterministic Monte Carlo iterations
   using the rating delta + all game context to produce win probabilities AND
   projected scores simultaneously
5. **Market calibration** — the betting line nudges the simulation's probability
   (not scores) when the market has information the model doesn't
6. **Thin-data confidence cap** — when critical factors are missing, probability
   is compressed toward 50% to prevent overconfident picks on thin evidence
7. **Build projection** — scores come directly from the simulation, quantized
   for display (no reconciliation or overwrite)

## Decision Profile

Every canonical result carries `decisionProfile`, a compact read on what the
unified system sees:

- simulation-market agreement (the simulation is the primary engine)
- non-Elo hidden support from injuries, rest, matchup, form, venue, weather, and sport-specific factors
- market disagreement and model-vs-consensus delta when market data exists
- upset/watchout scoring from simulation volatility and underdog pressure
- data and signal coverage so thin slates do not masquerade as strong edges

The adapter maps this profile into `edgeRating`, `valueRating`,
`lowDataWarning`, and `ensembleDivergence` for existing app surfaces.

## Simulation Details

The simulation is league-profiled:
- **NBA** uses possession proxy, recency-weighted net rating, usage-tier injury impact
- **NFL/NCAAF** use drive/tempo proxies
- **MLB** uses starter/bullpen run context with pitcher-specific FIP/ERA
- **NHL** uses confirmed starting goalie stats + special teams matchup
- **Soccer (EPL/MLS/UCL)** uses xG differential with regression penalty, keeps draw risk
- **IPL** uses T20 innings/run-rate context with venue/toss splits
- **Tennis** uses surface-specific win rates, set/match-format context

Missing critical simulator inputs do not get guessed; they create
`simulation-feature-gap` signals and widen variance (reducing confidence).

## Key Differences from v2 (factor-simulation-market-consensus-v1)

| Aspect | v2 (Old) | v3 (Unified) |
|--------|----------|--------------|
| Architecture | 3 separate brains (factor, simulation, market) blended | 1 simulation fed by factors, calibrated by market |
| Scores | Overwritten by reconciliation to match factor probability | Come directly from simulation |
| Factor weight | 80% of final answer | 0% direct vote (feeds INTO simulation) |
| Simulation weight | 8-14% challenge read | 100% — IS the answer |
| Market | 6-10% small vote | Post-processing calibration (10-25% by sport) |
| Disagreement | Factor vs simulation vs market | Only simulation vs market |
| Score-probability coherence | Forced via reconciliation | Natural (same source) |

## Backtesting

`bun run backtest:simulation --file <fixtures.json>` runs the production
engine against point-in-time `GameContext` snapshots with final scores. The
harness reports pick accuracy, confidence calibration, log loss, Brier score,
projected spread MAE, and projected total MAE. It intentionally refuses to
fabricate historical injuries, form, ratings, starters, or market lines; the
fixture file must contain what the model would have known before kickoff,
first pitch, puck drop, tip, match start, or toss.

Point-in-time Elo snapshots are now stored via `EloSnapshot` model, enabling
leak-free backtesting that uses the exact Elo rating the engine had at
prediction time rather than current ratings.

## Engine Contract

These rules are release gates for this engine:

- One source of truth: API and UI surfaces must use `canonicalResult` for the
  final pick, confidence, and displayed win probabilities.
- Scores and probability must agree: the projected score line must come from
  the same simulation that produced the probability. No reconciliation.
- Market data cannot be displayed and ignored. If ESPN provides a favorite,
  spread, or total and SharpAPI consensus is unavailable, the engine builds a
  conservative market fallback from the displayed odds metadata.
- Thin-data, market-disagreement, and engine-divergence spots must remain
  visible through `decisionProfile.tags`, `warnings`, and `engineBreakdown`.
- Confidence is the selected outcome probability. The engine does not inflate
  confidence to create stronger-looking picks.
- Missing critical factors REDUCE confidence (via redistribution drag and
  thin-data cap) rather than inflating Elo.

Live games keep the pregame canonical result. Predictions should only change
after a fresh model run with materially different inputs.

Development tracing is gated behind `PREDICTION_TRACE=1` on the backend and
`EXPO_PUBLIC_PREDICTION_TRACE=1` in the app.
