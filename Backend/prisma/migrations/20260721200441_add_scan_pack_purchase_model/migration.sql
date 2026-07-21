-- CreateTable
CREATE TABLE "ScanPackPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packKey" TEXT NOT NULL,
    "scans" INTEGER NOT NULL,
    "pricePaid" INTEGER NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanPackPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScanPackPurchase_stripeSessionId_key" ON "ScanPackPurchase"("stripeSessionId");

-- CreateIndex
CREATE INDEX "ScanPackPurchase_userId_idx" ON "ScanPackPurchase"("userId");

-- CreateIndex
CREATE INDEX "ScanPackPurchase_stripeSessionId_idx" ON "ScanPackPurchase"("stripeSessionId");

-- AddForeignKey
ALTER TABLE "ScanPackPurchase" ADD CONSTRAINT "ScanPackPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
