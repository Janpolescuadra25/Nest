/*
  Warnings:

  - You are about to drop the column `scanMode` on the `templates` table. All the data in the column will be lost.

*/
-- Add new column
ALTER TABLE "templates"
ADD COLUMN "scanModes" "ScanMode"[] DEFAULT ARRAY['IMAGE']::"ScanMode"[];

-- Data migration
UPDATE "templates"
SET "scanModes" = ARRAY["scanMode"]::"ScanMode"[]
WHERE "scanMode" IS NOT NULL;

-- Remove old column
ALTER TABLE "templates"
DROP COLUMN "scanMode";
