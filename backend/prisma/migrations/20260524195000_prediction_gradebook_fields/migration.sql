-- Add point-in-time gradebook fields to PredictionResult.
-- Nullable for existing production rows; new rows populate these at snapshot
-- and settlement time so calibration can be audited without recomputation.

ALTER TABLE "PredictionResult" ADD COLUMN "scheduledStart" TIMESTAMP(3);
ALTER TABLE "PredictionResult" ADD COLUMN "homeTeam" TEXT;
ALTER TABLE "PredictionResult" ADD COLUMN "awayTeam" TEXT;
ALTER TABLE "PredictionResult" ADD COLUMN "selectedOutcomeProb" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "brierScore" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "logLoss" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "finalHomeScore" INTEGER;
ALTER TABLE "PredictionResult" ADD COLUMN "finalAwayScore" INTEGER;
ALTER TABLE "PredictionResult" ADD COLUMN "marketHomeProb" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "marketAwayProb" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "marketDrawProb" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "marketDivergence" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "dataCoverage" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "signalCoverage" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "agreementScore" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "edgeRating" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "valueRating" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "riskScore" DOUBLE PRECISION;
ALTER TABLE "PredictionResult" ADD COLUMN "tagsJson" TEXT;
ALTER TABLE "PredictionResult" ADD COLUMN "dataSourcesJson" TEXT;
ALTER TABLE "PredictionResult" ADD COLUMN "gradeVersion" TEXT;
ALTER TABLE "PredictionResult" ADD COLUMN "gradedAt" TIMESTAMP(3);
ALTER TABLE "PredictionResult" ADD COLUMN "settledBy" TEXT;

UPDATE "PredictionResult"
SET "selectedOutcomeProb" = CASE
  WHEN COALESCE("predictedOutcome", "predictedWinner") = 'home' THEN
    COALESCE(
      "homeWinProb",
      LEAST(1.0, GREATEST(0.0, "confidence"::double precision / 100.0))
    )
  WHEN COALESCE("predictedOutcome", "predictedWinner") = 'away' THEN
    COALESCE(
      "awayWinProb",
      CASE
        WHEN "homeWinProb" IS NOT NULL THEN 1.0 - "homeWinProb"
        ELSE LEAST(1.0, GREATEST(0.0, "confidence"::double precision / 100.0))
      END
    )
  WHEN COALESCE("predictedOutcome", "predictedWinner") = 'draw' THEN
    COALESCE(
      "drawProb",
      LEAST(1.0, GREATEST(0.0, "confidence"::double precision / 100.0))
    )
  ELSE
    LEAST(1.0, GREATEST(0.0, "confidence"::double precision / 100.0))
END
WHERE "selectedOutcomeProb" IS NULL;

UPDATE "PredictionResult"
SET
  "brierScore" = POWER("selectedOutcomeProb" - CASE WHEN "wasCorrect" THEN 1.0 ELSE 0.0 END, 2),
  "logLoss" = -(
    CASE WHEN "wasCorrect" THEN 1.0 ELSE 0.0 END * LN(LEAST(0.999999999999999, GREATEST(0.000000000000001, "selectedOutcomeProb"))) +
    CASE WHEN "wasCorrect" THEN 0.0 ELSE 1.0 END * LN(1.0 - LEAST(0.999999999999999, GREATEST(0.000000000000001, "selectedOutcomeProb")))
  ),
  "gradeVersion" = COALESCE("gradeVersion", 'selected-outcome-v1'),
  "gradedAt" = COALESCE("gradedAt", "resolvedAt")
WHERE "wasCorrect" IS NOT NULL
  AND "selectedOutcomeProb" IS NOT NULL;

CREATE INDEX "PredictionResult_gradedAt_idx" ON "PredictionResult"("gradedAt");
CREATE INDEX "PredictionResult_scheduledStart_idx" ON "PredictionResult"("scheduledStart");
