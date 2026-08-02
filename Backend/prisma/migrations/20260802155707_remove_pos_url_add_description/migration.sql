/*
  Warnings:

  - You are about to drop the column `posUrl` on the `locations` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "locations" DROP COLUMN "posUrl",
ADD COLUMN     "description" TEXT;
