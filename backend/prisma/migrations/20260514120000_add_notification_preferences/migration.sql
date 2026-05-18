-- Persist per-user push notification preferences so background jobs honor
-- the app's notification settings outside the foreground handler.
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameLive" BOOLEAN NOT NULL DEFAULT true,
    "pickResult" BOOLEAN NOT NULL DEFAULT true,
    "predictionShift" BOOLEAN NOT NULL DEFAULT true,
    "bigGame" BOOLEAN NOT NULL DEFAULT true,
    "streak" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

ALTER TABLE "NotificationPreference"
ADD CONSTRAINT "NotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
