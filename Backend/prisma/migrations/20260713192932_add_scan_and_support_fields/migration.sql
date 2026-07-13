-- AlterTable
ALTER TABLE "users" ADD COLUMN     "maxScans" INTEGER,
ADD COLUMN     "prioritySupport" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scanHistoryDays" INTEGER;
