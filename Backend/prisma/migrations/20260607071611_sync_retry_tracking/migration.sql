-- AlterTable
ALTER TABLE "sync_logs" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "requestPayload" JSONB;
