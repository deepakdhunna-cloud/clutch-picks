# Prediction Engine Cutover Guide

## Feature Flag

The new honest prediction engine is gated behind `USE_NEW_PREDICTION_ENGINE`.

| Value | Behavior |
|-------|----------|
| `false` (default) | Old engine runs as primary. New engine runs in background, results logged to `backend/logs/prediction_shadow.jsonl` |
| `true` | New engine runs as primary. Old engine is bypassed. |

## How to Enable

1. Set environment variable: `USE_NEW_PREDICTION_ENGINE=true`
2. Restart the backend server
3. New predictions will use the honest engine immediately

## How to Roll Back

1. Set environment variable: `USE_NEW_PREDICTION_ENGINE=false` (or remove it)
2. Restart the backend server
3. Old engine resumes immediately — no data loss, no migration needed

## What to Watch in the First 24 Hours

1. **Shadow log**: Check `backend/logs/prediction_shadow.jsonl` for side-by-side comparison
   - Look for games where old confidence was 75%+ but new confidence is 55% — this is expected (old engine had artificial ceilings)
   - Look for games where new confidence > 80% — verify these are genuine mismatches
   - Check that new engine's `confidenceBand` matches the probability (coinflip for 50-53%, etc.)

2. **API response shape**: The new engine returns `confidenceBand` and drops `edgeRating`/`valueRating`. Verify the mobile app handles missing fields gracefully.

3. **Narrative quality**: New narratives are factor-driven and shorter (80-150 words). Check they read naturally and don't contain banned words.

4. **Calibration endpoint**: Hit `GET /api/calibration` — should return data even if sample sizes are tiny.

## Timeline

- **Shadow mode**: Run for 48+ hours before flipping
- **Review shadow log**: Deepak reviews manually before cutover
- **Old engine retention**: Keep old code (`backend/src/lib/predictions.ts`) for 2 weeks after cutover
- **Cleanup**: Delete old engine 2 weeks after stable cutover

## Files Involved

| File | Purpose |
|------|---------|
| `backend/src/prediction/` | New engine (all files) |
| `backend/src/prediction/shadow.ts` | Shadow logging + feature flag check |
| `backend/src/lib/predictions.ts` | Old engine (DO NOT DELETE until 2 weeks post-cutover) |
| `backend/logs/prediction_shadow.jsonl` | Shadow comparison data |
