-- Add draw-aware/versioned prediction audit fields.
-- All fields are nullable so existing production rows remain valid.
ALTER TABLE "PredictionResult" ADD COLUMN "predictedOutcome" TEXT;
ALTER TABLE "PredictionResult" ADD COLUMN "actualOutcome" TEXT;
ALTER TABLE "PredictionResult" ADD COLUMN "awayWinProb" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "drawProb" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "modelVersion" TEXT;

-- Backfill legacy rows with the binary fields we already had.
UPDATE "PredictionResult"
SET
  "predictedOutcome" = COALESCE("predictedOutcome", "predictedWinner"),
  "actualOutcome" = COALESCE("actualOutcome", "actualWinner"),
  "awayWinProb" = CASE
    WHEN "awayWinProb" IS NULL AND "homeWinProb" IS NOT NULL THEN 1.0 - "homeWinProb"
    ELSE "awayWinProb"
  END,
  "modelVersion" = COALESCE("modelVersion", 'unknown')
WHERE
  "predictedOutcome" IS NULL
  OR "actualOutcome" IS NULL
  OR ("awayWinProb" IS NULL AND "homeWinProb" IS NOT NULL)
  OR "modelVersion" IS NULL;

CREATE INDEX "PredictionResult_modelVersion_idx" ON "PredictionResult"("modelVersion");
CREATE INDEX "PredictionResult_predictedOutcome_idx" ON "PredictionResult"("predictedOutcome");
CREATE INDEX "PredictionResult_actualOutcome_idx" ON "PredictionResult"("actualOutcome");
