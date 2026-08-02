-- Step 1: Add locationId column (nullable first for backfill)
ALTER TABLE "products" ADD COLUMN "locationId" TEXT;

-- Step 2: Backfill — assign each product to a location.
-- Handles sub-users: uses adminId fallback (COALESCE) to match locations owned by admin.
UPDATE "products" p
SET "locationId" = sub.first_location_id
FROM (
  SELECT p2.id, l.id AS first_location_id
  FROM "products" p2
  JOIN "users" u ON u.id = p2."userId"
  JOIN "locations" l ON l."userId" = COALESCE(u."adminId", u.id)
  WHERE l.id = (
    SELECT id FROM "locations"
    WHERE "userId" = COALESCE(u."adminId", u.id)
    ORDER BY "createdAt" ASC
    LIMIT 1
  )
) sub
WHERE p.id = sub.id;

-- Step 3: Delete orphaned products (no matching location found)
DELETE FROM "products" WHERE "locationId" IS NULL;

-- Step 4: Make locationId NOT NULL
ALTER TABLE "products" ALTER COLUMN "locationId" SET NOT NULL;

-- Step 5: Add foreign key with cascade
ALTER TABLE "products" ADD CONSTRAINT "products_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Drop old unique index (it was created as an INDEX, not a CONSTRAINT)
DROP INDEX IF EXISTS "products_userId_name_key";

-- Step 7: Add new unique index
CREATE UNIQUE INDEX "products_locationId_name_key" ON "products"("locationId", "name");

-- Step 8: Add index
CREATE INDEX "products_locationId_idx" ON "products"("locationId");
