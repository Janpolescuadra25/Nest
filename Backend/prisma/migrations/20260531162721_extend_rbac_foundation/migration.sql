/*
  Warnings:

  - You are about to drop the column `meta` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `targetId` on the `audit_logs` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "UserStatus" ADD VALUE 'GRACE_PERIOD';
ALTER TYPE "UserStatus" ADD VALUE 'TIME_BOMBED';
ALTER TYPE "UserStatus" ADD VALUE 'BLOCKED';

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_targetId_fkey";

-- DropIndex
DROP INDEX "audit_logs_targetId_idx";

-- AlterTable
ALTER TABLE "audit_logs" RENAME COLUMN "targetId" TO "targetUserId";
ALTER TABLE "audit_logs" RENAME COLUMN "meta" TO "details";

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "docNumberTemplate" TEXT,
ADD COLUMN     "memoTemplate" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "gracePeriodHours" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN     "invitedById" TEXT,
ADD COLUMN     "permissions" JSONB,
ADD COLUMN     "timeBombAt" TIMESTAMP(3),
ADD COLUMN     "transferredFromId" TEXT;

-- CreateTable
CREATE TABLE "invite_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "roleHint" "UserRole",
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_links_token_key" ON "invite_links"("token");

-- CreateIndex
CREATE INDEX "invite_links_createdBy_idx" ON "invite_links"("createdBy");

-- CreateIndex
CREATE INDEX "invite_links_expiresAt_idx" ON "invite_links"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_targetUserId_idx" ON "audit_logs"("targetUserId");

-- CreateIndex
CREATE INDEX "scan_records_createdAt_idx" ON "scan_records"("createdAt");

-- CreateIndex
CREATE INDEX "users_blockedById_idx" ON "users"("blockedById");

-- CreateIndex
CREATE INDEX "users_approvedById_idx" ON "users"("approvedById");

-- CreateIndex
CREATE INDEX "users_invitedById_idx" ON "users"("invitedById");

-- CreateIndex
CREATE INDEX "users_transferredFromId_idx" ON "users"("transferredFromId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_transferredFromId_fkey" FOREIGN KEY ("transferredFromId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
