-- AlterTable
ALTER TABLE "mappings" ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL DEFAULT 'JOURNAL_ENTRY',
    "lineType" TEXT NOT NULL DEFAULT 'journal_entry',
    "version" INTEGER NOT NULL DEFAULT 1,
    "defaults" JSONB,
    "columnMappings" JSONB,
    "memoTemplate" TEXT,
    "docNumberTemplate" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "templates_locationId_idx" ON "templates"("locationId");

-- CreateIndex
CREATE INDEX "mappings_templateId_idx" ON "mappings"("templateId");

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mappings" ADD CONSTRAINT "mappings_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
