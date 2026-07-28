-- CreateTable
CREATE TABLE "PayeeMapping" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "scannedName" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "matchingRule" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayeeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayeeMapping_templateId_idx" ON "PayeeMapping"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "PayeeMapping_templateId_scannedName_key" ON "PayeeMapping"("templateId", "scannedName");

-- AddForeignKey
ALTER TABLE "PayeeMapping" ADD CONSTRAINT "PayeeMapping_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
