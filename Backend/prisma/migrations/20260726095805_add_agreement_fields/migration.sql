-- AlterTable
ALTER TABLE "users" ADD COLUMN     "agreementDate" TIMESTAMP(3),
ADD COLUMN     "agreementPrice" DECIMAL(10,2),
ADD COLUMN     "agreementTerms" TEXT;
