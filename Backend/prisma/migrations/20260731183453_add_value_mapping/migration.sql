-- CreateTable
CREATE TABLE "ValueMapping" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "scannedText" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "matchingRule" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValueMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ValueMapping_templateId_idx" ON "ValueMapping"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "ValueMapping_templateId_fieldType_scannedText_key" ON "ValueMapping"("templateId", "fieldType", "scannedText");

-- AddForeignKey
ALTER TABLE "ValueMapping" ADD CONSTRAINT "ValueMapping_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
