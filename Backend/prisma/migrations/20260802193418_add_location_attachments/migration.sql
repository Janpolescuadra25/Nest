-- CreateTable
CREATE TABLE "location_attachments" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "location_attachments_storageKey_key" ON "location_attachments"("storageKey");

-- CreateIndex
CREATE INDEX "location_attachments_locationId_idx" ON "location_attachments"("locationId");

-- AddForeignKey
ALTER TABLE "location_attachments" ADD CONSTRAINT "location_attachments_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_attachments" ADD CONSTRAINT "location_attachments_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
