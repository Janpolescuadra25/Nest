-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxLocations" INTEGER,
ADD COLUMN     "paymentIssue" BOOLEAN NOT NULL DEFAULT false;
