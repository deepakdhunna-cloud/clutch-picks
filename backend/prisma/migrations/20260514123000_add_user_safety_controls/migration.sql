CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");
CREATE INDEX "UserBlock_blockerId_idx" ON "UserBlock"("blockerId");
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

ALTER TABLE "UserBlock"
ADD CONSTRAINT "UserBlock_blockerId_fkey"
FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBlock"
ADD CONSTRAINT "UserBlock_blockedId_fkey"
FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentReport_reportedUserId_createdAt_idx" ON "ContentReport"("reportedUserId", "createdAt");
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt");
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");

ALTER TABLE "ContentReport"
ADD CONSTRAINT "ContentReport_reporterId_fkey"
FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentReport"
ADD CONSTRAINT "ContentReport_reportedUserId_fkey"
FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
