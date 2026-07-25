-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "scanRecordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_scanRecordId_idx" ON "Attachment"("scanRecordId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_scanRecordId_fkey" FOREIGN KEY ("scanRecordId") REFERENCES "scan_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
