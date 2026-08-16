-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "scan_records_locationId_status_idx" ON "scan_records"("locationId", "status");

-- CreateIndex
CREATE INDEX "sync_logs_userId_syncedAt_idx" ON "sync_logs"("userId", "syncedAt");

-- CreateIndex
CREATE INDEX "users_adminId_role_idx" ON "users"("adminId", "role");
