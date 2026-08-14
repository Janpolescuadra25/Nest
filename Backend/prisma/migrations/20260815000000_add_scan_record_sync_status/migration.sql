-- AlterTable
ALTER TABLE "scan_records" ADD COLUMN "syncStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "scan_records" ADD COLUMN "lastSyncError" TEXT;
