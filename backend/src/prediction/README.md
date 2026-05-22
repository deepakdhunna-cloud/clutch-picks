# Prediction Decision Flow

`predictGame(ctx)` is the single pregame engine entry point. It computes factor
ratings, runs the game-script simulation/projection, applies the small market
calibration vote when available, reconciles any projection disagreement, and
returns one `canonicalResult`.

The canonical object lives on `HonestPrediction.canonicalResult` and is carried
through the API as `GamePrediction.canonicalResult`. UI surfaces must read the
final pick, final probability, confidence, and win-probability display from
that object. Legacy fields such as `predictedWinner`, `confidence`,
`homeWinProbability`, and `projection.*WinProbability` are mirrored for older
components, but they are not the source of truth.

## Reconciliation

The orchestrator uses `factor-simulation-market-consensus-v1`:

- factors are the primary model read
- game-script simulation runs 50,000 deterministic game scripts and contributes distribution plus expected-score context
- market consensus is optional and only a small calibration input
- if sub-engines disagree, the disagreement remains in `engineBreakdown`
- the final displayed answer comes from the `orchestrator-v1` read

Live games keep the pregame canonical result. Scoreboard state can update, but
it does not rewrite the betting-facing pick, confidence, or projection simply
because one team is currently trailing or leading in-game. Predictions should
only change after a fresh model run with materially different inputs, and the
API suppresses small visible updates unless the pick, probability, projection,
or market-divergence move is large enough to matter.

Development tracing is gated behind `PREDICTION_TRACE=1` on the backend and
`EXPO_PUBLIC_PREDICTION_TRACE=1` in the app.
