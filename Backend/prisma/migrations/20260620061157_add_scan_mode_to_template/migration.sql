/*
  Warnings:

  - Added the required column `syncType` to the `sync_logs` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ScanMode" AS ENUM ('IMAGE', 'EXCEL', 'POS');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('JOURNAL_ENTRY', 'BILL', 'VENDOR_CREDIT', 'CHEQUE');

-- AlterTable
ALTER TABLE "sync_logs" ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "syncType" "SyncType" NOT NULL,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "scanRecordId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "templates" ADD COLUMN     "posSystem" TEXT,
ADD COLUMN     "scanMode" "ScanMode" NOT NULL DEFAULT 'IMAGE';

-- CreateIndex
CREATE INDEX "sync_logs_userId_idx" ON "sync_logs"("userId");

-- CreateIndex
CREATE INDEX "sync_logs_syncType_requestHash_idx" ON "sync_logs"("syncType", "requestHash");

-- CreateIndex
CREATE INDEX "sync_logs_userId_syncType_requestHash_idx" ON "sync_logs"("userId", "syncType", "requestHash");

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
