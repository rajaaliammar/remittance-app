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
    // Customer profile fields used by dynamic registration settings
    'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "middleName" TEXT',
    'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "telephone" TEXT',
    'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "unitApt" TEXT',
    'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "zipCode" TEXT',
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

// Ensure registration_settings table exists
async function ensureRegistrationSettingsTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "registration_settings" (
        "id" TEXT NOT NULL,
        "phoneNumber" BOOLEAN NOT NULL DEFAULT true,
        "phoneNumberRequired" BOOLEAN NOT NULL DEFAULT true,
        "emailAddress" BOOLEAN NOT NULL DEFAULT true,
        "emailAddressRequired" BOOLEAN NOT NULL DEFAULT false,
        "fullName" BOOLEAN NOT NULL DEFAULT true,
        "fullNameRequired" BOOLEAN NOT NULL DEFAULT true,
        "middleName" BOOLEAN NOT NULL DEFAULT false,
        "middleNameRequired" BOOLEAN NOT NULL DEFAULT false,
        "telephone" BOOLEAN NOT NULL DEFAULT false,
        "telephoneRequired" BOOLEAN NOT NULL DEFAULT false,
        "unitApt" BOOLEAN NOT NULL DEFAULT false,
        "unitAptRequired" BOOLEAN NOT NULL DEFAULT false,
        "zipCode" BOOLEAN NOT NULL DEFAULT false,
        "zipCodeRequired" BOOLEAN NOT NULL DEFAULT false,
        "dateOfBirth" BOOLEAN NOT NULL DEFAULT false,
        "dateOfBirthRequired" BOOLEAN NOT NULL DEFAULT false,
        "gender" BOOLEAN NOT NULL DEFAULT false,
        "genderRequired" BOOLEAN NOT NULL DEFAULT false,
        "nationality" BOOLEAN NOT NULL DEFAULT false,
        "nationalityRequired" BOOLEAN NOT NULL DEFAULT false,
        "country" BOOLEAN NOT NULL DEFAULT false,
        "countryRequired" BOOLEAN NOT NULL DEFAULT false,
        "regionState" BOOLEAN NOT NULL DEFAULT false,
        "regionStateRequired" BOOLEAN NOT NULL DEFAULT false,
        "woredaDistrict" BOOLEAN NOT NULL DEFAULT false,
        "woredaDistrictRequired" BOOLEAN NOT NULL DEFAULT false,
        "city" BOOLEAN NOT NULL DEFAULT false,
        "cityRequired" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "registration_settings_pkey" PRIMARY KEY ("id")
      )
    `);

    const addColumnStatements = [
      'ALTER TABLE "registration_settings" ADD COLUMN IF NOT EXISTS "middleName" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "registration_settings" ADD COLUMN IF NOT EXISTS "middleNameRequired" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "registration_settings" ADD COLUMN IF NOT EXISTS "telephone" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "registration_settings" ADD COLUMN IF NOT EXISTS "telephoneRequired" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "registration_settings" ADD COLUMN IF NOT EXISTS "unitApt" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "registration_settings" ADD COLUMN IF NOT EXISTS "unitAptRequired" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "registration_settings" ADD COLUMN IF NOT EXISTS "zipCode" BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE "registration_settings" ADD COLUMN IF NOT EXISTS "zipCodeRequired" BOOLEAN NOT NULL DEFAULT false',
    ];
    for (const sql of addColumnStatements) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (colErr) {
        console.warn('ensureRegistrationSettingsTable (add column):', colErr.message);
      }
    }
  } catch (e) {
    console.warn('ensureRegistrationSettingsTable:', e.message);
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
export { ensureLevelAndBalanceLimitColumns, ensureLevelsTable, ensureRegistrationSettingsTable };

