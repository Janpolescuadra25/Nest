-- AlterTable
ALTER TABLE "invite_links" ADD COLUMN     "maxLocations" INTEGER,
ADD COLUMN     "maxScans" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "allocatedStorageBytes" INTEGER,
ADD COLUMN     "poolStorageBytes" INTEGER;
