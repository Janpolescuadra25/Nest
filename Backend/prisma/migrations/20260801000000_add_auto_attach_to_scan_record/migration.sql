-- Add autoAttach to ScanRecord to control QuickBooks attachment syncing
ALTER TABLE "scan_records"
ADD COLUMN "autoAttach" BOOLEAN NOT NULL DEFAULT true;
