-- Populate user permissions JSON from legacy canX boolean fields.
UPDATE "users" SET "permissions" = COALESCE("permissions", '{}') || jsonb_build_object(
  'scan:read', "canScan",
  'scan:write', "canScan",
  'map:read', "canMap",
  'map:write', "canMap",
  'sync:read', "canSync",
  'sync:execute', "canSync",
  'locations:read', "canManageLocs",
  'locations:write', "canManageLocs"
);
