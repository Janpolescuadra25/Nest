/*
  Warnings:

  - You are about to drop the column `docNumberTemplate` on the `locations` table. All the data in the column will be lost.
  - You are about to drop the column `memoTemplate` on the `locations` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "locations" DROP COLUMN "docNumberTemplate",
DROP COLUMN "memoTemplate";
