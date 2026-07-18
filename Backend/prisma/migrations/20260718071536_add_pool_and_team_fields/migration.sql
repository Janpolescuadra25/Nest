-- AlterTable
ALTER TABLE "users" ADD COLUMN     "allocatedLocations" INTEGER,
ADD COLUMN     "allocatedScans" INTEGER,
ADD COLUMN     "managedById" TEXT,
ADD COLUMN     "maxMembers" INTEGER,
ADD COLUMN     "poolLocations" INTEGER,
ADD COLUMN     "poolScans" INTEGER;

-- CreateIndex
CREATE INDEX "users_managedById_idx" ON "users"("managedById");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_managedById_fkey" FOREIGN KEY ("managedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
