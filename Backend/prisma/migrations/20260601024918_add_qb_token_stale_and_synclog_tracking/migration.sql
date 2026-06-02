-- AlterTable
ALTER TABLE "qb_tokens" ADD COLUMN     "stale" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sync_logs" ADD COLUMN     "docNumber" TEXT,
ADD COLUMN     "errorType" TEXT;
