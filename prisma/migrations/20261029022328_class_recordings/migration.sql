-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RECORDING_READY';

-- CreateTable
CREATE TABLE "ClassRecording" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "egressId" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'PENDING',
    "spoolFile" TEXT NOT NULL,
    "storageKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassRecording_egressId_key" ON "ClassRecording"("egressId");

-- CreateIndex
CREATE INDEX "ClassRecording_sessionId_idx" ON "ClassRecording"("sessionId");

-- CreateIndex
CREATE INDEX "ClassRecording_status_claimedAt_idx" ON "ClassRecording"("status", "claimedAt");

-- AddForeignKey
ALTER TABLE "ClassRecording" ADD CONSTRAINT "ClassRecording_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
