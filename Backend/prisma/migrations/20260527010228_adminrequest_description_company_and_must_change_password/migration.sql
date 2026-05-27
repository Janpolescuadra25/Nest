/*
  Warnings:

  - You are about to drop the column `message` on the `admin_requests` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "admin_requests" DROP COLUMN "message",
ADD COLUMN     "company" TEXT,
ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
