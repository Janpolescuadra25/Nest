-- AlterTable
ALTER TABLE "scan_records" ADD COLUMN     "rawScanEntry" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'pos';

-- CreateIndex
CREATE INDEX "scan_records_source_idx" ON "scan_records"("source");
