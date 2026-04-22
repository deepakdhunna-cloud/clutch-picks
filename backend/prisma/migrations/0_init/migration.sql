-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "bio" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPick" (
    "id" TEXT NOT NULL,
    "odId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "pickedTeam" TEXT NOT NULL,
    "result" TEXT,
    "modelPredictedWinner" TEXT,
    "modelConfidence" INTEGER,
    "modelHomeWinProb" INTEGER,
    "finalHomeScore" INTEGER,
    "finalAwayScore" INTEGER,
    "homeTeam" TEXT,
    "awayTeam" TEXT,
    "sport" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerNews" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "impact" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerNews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamFollow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "teamAbbreviation" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamFollow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EloRating" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EloRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionResult" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "predictedWinner" TEXT NOT NULL,
    "actualWinner" TEXT,
    "confidence" INTEGER NOT NULL,
    "isTossUp" BOOLEAN NOT NULL DEFAULT false,
    "wasCorrect" BOOLEAN,
    "homeElo" DOUBLE PRECISION,
    "awayElo" DOUBLE PRECISION,
    "homeWinProb" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PredictionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalibrationSnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "league" TEXT NOT NULL,
    "brierScore" DOUBLE PRECISION NOT NULL,
    "logLoss" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "reliabilityCurveJson" TEXT NOT NULL,

    CONSTRAINT "CalibrationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'lifetime',
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "currentUses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "gameId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAvailability" (
    "id" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamAbbreviation" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sourceCredibility" DOUBLE PRECISION NOT NULL,
    "gameImpactElo" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "reasoning" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionVersion" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "homeWinProb" DOUBLE PRECISION NOT NULL,
    "awayWinProb" DOUBLE PRECISION NOT NULL,
    "drawProb" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "confidenceBand" TEXT NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "triggerSourceId" TEXT,
    "factorsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShadowComparison" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "matchup" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "oldPredictedWinner" TEXT NOT NULL,
    "oldHomeWinProb" DOUBLE PRECISION NOT NULL,
    "oldConfidence" DOUBLE PRECISION NOT NULL,
    "newPredictedWinner" TEXT,
    "newHomeWinProb" DOUBLE PRECISION NOT NULL,
    "newAwayWinProb" DOUBLE PRECISION NOT NULL,
    "newDrawProb" DOUBLE PRECISION,
    "newConfidence" DOUBLE PRECISION NOT NULL,
    "newConfidenceBand" TEXT NOT NULL,
    "unavailableFactorsJson" TEXT NOT NULL,
    "agreement" BOOLEAN NOT NULL,
    "confidenceDelta" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShadowComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMNarrativeCache" (
    "gameId" TEXT NOT NULL,
    "versionHash" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LLMNarrativeCache_pkey" PRIMARY KEY ("gameId","versionHash")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isClosing" BOOLEAN NOT NULL DEFAULT false,
    "pinnacleHomeNoVig" DOUBLE PRECISION,
    "pinnacleAwayNoVig" DOUBLE PRECISION,
    "pinnacleDrawNoVig" DOUBLE PRECISION,
    "avgHomeProb" DOUBLE PRECISION NOT NULL,
    "avgAwayProb" DOUBLE PRECISION NOT NULL,
    "linesJson" TEXT NOT NULL,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserPick_odId_createdAt_idx" ON "UserPick"("odId", "createdAt");

-- CreateIndex
CREATE INDEX "UserPick_gameId_idx" ON "UserPick"("gameId");

-- CreateIndex
CREATE INDEX "UserPick_result_idx" ON "UserPick"("result");

-- CreateIndex
CREATE UNIQUE INDEX "UserPick_odId_gameId_key" ON "UserPick"("odId", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "Follow"("followerId");

-- CreateIndex
CREATE INDEX "Follow_followingId_idx" ON "Follow"("followingId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "PlayerNews_teamId_idx" ON "PlayerNews"("teamId");

-- CreateIndex
CREATE INDEX "PlayerNews_sport_idx" ON "PlayerNews"("sport");

-- CreateIndex
CREATE INDEX "PlayerNews_createdAt_idx" ON "PlayerNews"("createdAt");

-- CreateIndex
CREATE INDEX "TeamFollow_userId_idx" ON "TeamFollow"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamFollow_userId_teamId_key" ON "TeamFollow"("userId", "teamId");

-- CreateIndex
CREATE INDEX "AppNotification_userId_read_idx" ON "AppNotification"("userId", "read");

-- CreateIndex
CREATE INDEX "AppNotification_userId_createdAt_idx" ON "AppNotification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EloRating_sport_teamId_key" ON "EloRating"("sport", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionResult_gameId_key" ON "PredictionResult"("gameId");

-- CreateIndex
CREATE INDEX "PredictionResult_sport_idx" ON "PredictionResult"("sport");

-- CreateIndex
CREATE INDEX "PredictionResult_wasCorrect_idx" ON "PredictionResult"("wasCorrect");

-- CreateIndex
CREATE INDEX "PredictionResult_createdAt_idx" ON "PredictionResult"("createdAt");

-- CreateIndex
CREATE INDEX "PredictionResult_sport_wasCorrect_idx" ON "PredictionResult"("sport", "wasCorrect");

-- CreateIndex
CREATE INDEX "CalibrationSnapshot_league_idx" ON "CalibrationSnapshot"("league");

-- CreateIndex
CREATE INDEX "CalibrationSnapshot_date_idx" ON "CalibrationSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "CalibrationSnapshot_date_league_key" ON "CalibrationSnapshot"("date", "league");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCode_code_idx" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoRedemption_userId_idx" ON "PromoRedemption"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_promoCodeId_userId_key" ON "PromoRedemption"("promoCodeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_sentAt_idx" ON "NotificationLog"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "NotificationLog_type_sentAt_idx" ON "NotificationLog"("type", "sentAt");

-- CreateIndex
CREATE INDEX "PlayerAvailability_teamAbbreviation_sport_createdAt_idx" ON "PlayerAvailability"("teamAbbreviation", "sport", "createdAt");

-- CreateIndex
CREATE INDEX "PlayerAvailability_playerName_sport_idx" ON "PlayerAvailability"("playerName", "sport");

-- CreateIndex
CREATE INDEX "PlayerAvailability_expiresAt_idx" ON "PlayerAvailability"("expiresAt");

-- CreateIndex
CREATE INDEX "PredictionVersion_gameId_version_idx" ON "PredictionVersion"("gameId", "version");

-- CreateIndex
CREATE INDEX "PredictionVersion_gameId_createdAt_idx" ON "PredictionVersion"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "PredictionVersion_sport_createdAt_idx" ON "PredictionVersion"("sport", "createdAt");

-- CreateIndex
CREATE INDEX "ShadowComparison_gameId_idx" ON "ShadowComparison"("gameId");

-- CreateIndex
CREATE INDEX "ShadowComparison_league_createdAt_idx" ON "ShadowComparison"("league", "createdAt");

-- CreateIndex
CREATE INDEX "ShadowComparison_createdAt_idx" ON "ShadowComparison"("createdAt");

-- CreateIndex
CREATE INDEX "LLMNarrativeCache_generatedAt_idx" ON "LLMNarrativeCache"("generatedAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_gameId_fetchedAt_idx" ON "MarketSnapshot"("gameId", "fetchedAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_sport_fetchedAt_idx" ON "MarketSnapshot"("sport", "fetchedAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_gameId_isClosing_idx" ON "MarketSnapshot"("gameId", "isClosing");

-- AddForeignKey
ALTER TABLE "UserPick" ADD CONSTRAINT "UserPick_odId_fkey" FOREIGN KEY ("odId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

