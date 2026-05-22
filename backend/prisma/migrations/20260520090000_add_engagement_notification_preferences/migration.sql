-- Add release notification categories for editorial game highlights and
-- underdog alerts.
ALTER TABLE "NotificationPreference"
ADD COLUMN "gameSpotlight" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "underdog" BOOLEAN NOT NULL DEFAULT true;
