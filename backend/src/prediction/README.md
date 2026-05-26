# Prediction Decision Flow

`predictGame(ctx)` is the single pregame engine entry point. It validates the
available matchup context, computes the factor-model read, runs the
league-specific game-script simulation as an independent challenge read, applies
the small market calibration vote when available, preserves raw projection
disagreement as a separate engine read, and returns one `canonicalResult`.

The canonical object lives on `HonestPrediction.canonicalResult` and is carried
through the API as `GamePrediction.canonicalResult`. UI surfaces must read the
final pick, final probability, confidence, and win-probability display from
that object. Legacy fields such as `predictedWinner`, `confidence`,
`homeWinProbability`, and `projection.*WinProbability` are mirrored for older
components, but they are not the source of truth.

## Unified Decision Profile

Every canonical result now also carries `decisionProfile`, a compact read on
what the unified system actually sees:

- cross-engine agreement between factors, game-script projection, and optional market calibration
- non-Elo hidden support from injuries, rest, matchup, form, venue, weather, and sport-specific factors
- market disagreement and model-vs-consensus delta when market data exists
- upset/watchout scoring from projection volatility, disagreement, and underdog pressure
- data and signal coverage so thin slates do not masquerade as strong edges

The adapter maps this profile into `edgeRating`, `valueRating`,
`lowDataWarning`, and `ensembleDivergence` for existing app surfaces.

## Reconciliation

The orchestrator uses `factor-simulation-market-consensus-v1`:

- factors are the primary model read
- game-script simulation runs 50,000 deterministic game scripts and contributes distribution plus expected-score context
- simulation is league-profiled: NBA uses a possession proxy, NFL/NCAAF use drive/tempo proxies, MLB uses starter/bullpen run context, NHL uses goalie/special-teams context, soccer keeps draw-risk, IPL uses T20 innings/run-rate context, and tennis uses set/match-format context
- missing critical simulator inputs do not get guessed; they create `simulation-feature-gap` signals and widen variance
- the simulator receives the rating edge as a league-specific prior, but it can disagree when the independent scoring script points the other way
- factor/simulation tension creates a `factor-script-tension` signal instead of being hidden
- market consensus is optional and only a small calibration input
- if sub-engines disagree, the disagreement remains in `engineBreakdown`
- the public score projection is reconciled to the final orchestrator pick,
  while the raw simulator read remains in `engineBreakdown` and
  `simulationSummary`
- the final displayed answer comes from the `orchestrator-v1` read

## Backtesting

`bun run backtest:simulation --file <fixtures.json>` runs the production
engine against point-in-time `GameContext` snapshots with final scores. The
harness reports pick accuracy, confidence calibration, log loss, Brier score,
projected spread MAE, and projected total MAE. It intentionally refuses to
fabricate historical injuries, form, ratings, starters, or market lines; the
fixture file must contain what the model would have known before kickoff,
first pitch, puck drop, tip, match start, or toss.

`bun run backtest:historical-current -- --sports NBA,MLB,NHL --days 60` runs
an approximate replay using real completed ESPN scoreboards, chronological
rolling Elo, and the current engine/context builder. Its report is useful for
directional QA and league triage, but not for official accuracy claims because
rebuilt injuries, form, standings, weather, and provider feeds may reflect
current availability rather than the exact pregame snapshot.

## Engine Contract

These rules are release gates for this engine. A change that violates one of
these rules is not ready to ship.

- One source of truth: API and UI surfaces must use `canonicalResult` for the
  final pick, confidence, and displayed win probabilities.
- Market data cannot be displayed and ignored. If ESPN provides a favorite,
  spread, or total and SharpAPI consensus is unavailable, the engine builds a
  conservative market fallback from the displayed odds metadata and marks it as
  fallback market calibration.
- Projection and simulation are separate reads. Raw simulation can disagree,
  but the public projection object must be reconciled to the final pick so the
  card does not show one winner in the pick and another winner in the projected
  score.
- Thin-data, market-disagreement, and engine-divergence spots must remain
  visible through `decisionProfile.tags`, `warnings`, and `engineBreakdown`.
- Confidence is the selected outcome probability. The engine does not inflate
  confidence to create stronger-looking picks.
- Release checks must cover the prediction/projection/simulation/market
  contract, not only a single game example.

Live games keep the pregame canonical result. Scoreboard state can update, but
it does not rewrite the betting-facing pick, confidence, or projection simply
because one team is currently trailing or leading in-game. Predictions should
only change after a fresh model run with materially different inputs, and the
API suppresses small visible updates unless the pick, probability, projection,
or market-divergence move is large enough to matter.

Development tracing is gated behind `PREDICTION_TRACE=1` on the backend and
`EXPO_PUBLIC_PREDICTION_TRACE=1` in the app.
