/*
  Warnings:

  - You are about to drop the column `canManageLocs` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `canMap` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `canScan` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `canSync` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "canManageLocs",
DROP COLUMN "canMap",
DROP COLUMN "canScan",
DROP COLUMN "canSync";
