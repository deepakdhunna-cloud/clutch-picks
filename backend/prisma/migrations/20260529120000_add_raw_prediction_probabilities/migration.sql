-- Add raw (pre-self-learning-calibration) probability columns to PredictionResult.
-- Additive and nullable: existing rows keep NULL (they stored post-adjustment
-- probabilities and cannot be backfilled). Grading/recalibration prefer these
-- raw values when present, breaking the self-learning feedback loop.
ALTER TABLE "PredictionResult" ADD COLUMN "rawHomeWinProb" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "rawAwayWinProb" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "rawDrawProb" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "rawSelectedOutcomeProb" DOUBLE PRECISION;
