-- Create accounting tables without running full migrations.
-- Run with: npx prisma db execute --file prisma/create_accounting_tables.sql
-- Or: psql $DATABASE_URL -f prisma/create_accounting_tables.sql

-- accounting_entries
CREATE TABLE IF NOT EXISTS "accounting_entries" (
  "id" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "category" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "description" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "remittanceTransactionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "accounting_entries_entryType_idx" ON "accounting_entries"("entryType");
CREATE INDEX IF NOT EXISTS "accounting_entries_category_idx" ON "accounting_entries"("category");
CREATE INDEX IF NOT EXISTS "accounting_entries_referenceType_referenceId_idx" ON "accounting_entries"("referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "accounting_entries_remittanceTransactionId_idx" ON "accounting_entries"("remittanceTransactionId");
CREATE INDEX IF NOT EXISTS "accounting_entries_createdAt_idx" ON "accounting_entries"("createdAt");

ALTER TABLE "accounting_entries" DROP CONSTRAINT IF EXISTS "accounting_entries_remittanceTransactionId_fkey";
ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_remittanceTransactionId_fkey"
  FOREIGN KEY ("remittanceTransactionId") REFERENCES "remittance_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- accounting_periods
CREATE TABLE IF NOT EXISTS "accounting_periods" (
  "id" TEXT NOT NULL,
  "periodType" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "totalRevenue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "totalExpenses" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "totalFees" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "netProfit" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "accounting_periods_periodType_periodStart_periodEnd_key"
  ON "accounting_periods"("periodType", "periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "accounting_periods_periodType_idx" ON "accounting_periods"("periodType");
CREATE INDEX IF NOT EXISTS "accounting_periods_periodStart_periodEnd_idx" ON "accounting_periods"("periodStart", "periodEnd");
