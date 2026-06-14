-- CreateTable
CREATE TABLE "mapping_preferences" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "timesAccepted" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mapping_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mapping_preferences_locationId_idx" ON "mapping_preferences"("locationId");

-- CreateIndex
CREATE INDEX "mapping_preferences_sourceField_idx" ON "mapping_preferences"("sourceField");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_preferences_locationId_sourceField_accountId_key" ON "mapping_preferences"("locationId", "sourceField", "accountId");

-- AddForeignKey
ALTER TABLE "mapping_preferences" ADD CONSTRAINT "mapping_preferences_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
