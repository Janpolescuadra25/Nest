/*
  Warnings:

  - A unique constraint covering the columns `[templateId,fieldType,sourceField,scannedText]` on the table `ValueMapping` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "ValueMapping_templateId_fieldType_scannedText_key";

-- AlterTable
ALTER TABLE "ValueMapping" ADD COLUMN     "sourceField" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ValueMapping_templateId_fieldType_sourceField_scannedText_key" ON "ValueMapping"("templateId", "fieldType", "sourceField", "scannedText");
