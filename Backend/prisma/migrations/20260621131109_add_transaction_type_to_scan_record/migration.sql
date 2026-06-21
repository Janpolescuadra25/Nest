-- AlterTable
ALTER TABLE "scan_records" ADD COLUMN     "transactionType" TEXT NOT NULL DEFAULT 'JOURNAL_ENTRY';
