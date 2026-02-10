import { PrismaClient } from '@prisma/client';

// Create a singleton instance of Prisma Client
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Ensure level and balanceLimit columns exist (safe to run every startup)
async function ensureLevelAndBalanceLimitColumns() {
  const statements = [
    'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "level" TEXT',
    'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "balanceLimit" TEXT',
    'ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "level" TEXT',
    'ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "balanceLimit" TEXT',
    'ALTER TABLE "backoffice_users" ADD COLUMN IF NOT EXISTS "level" TEXT',
    'ALTER TABLE "backoffice_users" ADD COLUMN IF NOT EXISTS "balanceLimit" TEXT',
  ];
  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn('ensureLevelAndBalanceLimitColumns:', e.message);
    }
  }
}

// Ensure levels table exists (for Level & Limit Management)
async function ensureLevelsTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "levels" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "priority" INTEGER NOT NULL,
        "description" TEXT,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "transactionLimits" JSONB,
        "kycRequirements" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
      )
    `);
  } catch (e) {
    console.warn('ensureLevelsTable:', e.message);
  }
}

// Handle Prisma Client connection (columns are ensured on first connect)
prisma.$connect()
  .then(() => {
    console.log('✅ Prisma Client connected to database');
    return ensureLevelAndBalanceLimitColumns();
  })
  .catch((error) => {
    console.error('❌ Failed to connect to database:', error);
  });

export default prisma;
export { ensureLevelAndBalanceLimitColumns, ensureLevelsTable };

