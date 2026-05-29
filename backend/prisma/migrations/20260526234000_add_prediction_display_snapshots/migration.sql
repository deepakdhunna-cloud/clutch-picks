ALTER TABLE "PredictionResult"
  ADD COLUMN IF NOT EXISTS "analysisSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "projectionJson" TEXT,
  ADD COLUMN IF NOT EXISTS "canonicalResultJson" TEXT;
