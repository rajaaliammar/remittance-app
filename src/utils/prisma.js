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

/**
 * Ensure compliance schema is present on existing databases without requiring
 * a manual migration. Adds:
 *   - customers.lastTransactionAt        (used by B9/B10 inactive-account rules)
 *   - remittance_transactions.riskScore, triggeredRules, ipAddress, deviceId,
 *     complianceHoldAt, complianceReviewNote
 *   - compliance_alerts table (one row per matched rule per held transaction)
 *
 * Safe to run on every startup — every statement uses IF NOT EXISTS / IF EXISTS.
 */
async function ensureComplianceColumnsAndTables() {
  const columnStatements = [
    'ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "lastTransactionAt" TIMESTAMP(3)',

    'ALTER TABLE "remittance_transactions" ADD COLUMN IF NOT EXISTS "riskScore" INTEGER',
    'ALTER TABLE "remittance_transactions" ADD COLUMN IF NOT EXISTS "triggeredRules" JSONB',
    'ALTER TABLE "remittance_transactions" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT',
    'ALTER TABLE "remittance_transactions" ADD COLUMN IF NOT EXISTS "deviceId" TEXT',
    'ALTER TABLE "remittance_transactions" ADD COLUMN IF NOT EXISTS "complianceHoldAt" TIMESTAMP(3)',
    'ALTER TABLE "remittance_transactions" ADD COLUMN IF NOT EXISTS "complianceReviewNote" TEXT',
  ];
  for (const sql of columnStatements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn('ensureComplianceColumnsAndTables (column):', e.message);
    }
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "compliance_alerts" (
        "id"            TEXT NOT NULL,
        "transactionId" TEXT NOT NULL,
        "customerId"    TEXT NOT NULL,
        "ruleCode"      TEXT NOT NULL,
        "reason"        TEXT NOT NULL,
        "details"       JSONB,
        "status"        TEXT NOT NULL DEFAULT 'OPEN',
        "resolvedBy"    TEXT,
        "resolvedAt"    TIMESTAMP(3),
        "resolvedNote"  TEXT,
        "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "compliance_alerts_pkey" PRIMARY KEY ("id")
      )
    `);
  } catch (e) {
    console.warn('ensureComplianceColumnsAndTables (compliance_alerts):', e.message);
  }

  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS "compliance_alerts_status_idx"        ON "compliance_alerts" ("status")',
    'CREATE INDEX IF NOT EXISTS "compliance_alerts_customerId_idx"    ON "compliance_alerts" ("customerId")',
    'CREATE INDEX IF NOT EXISTS "compliance_alerts_transactionId_idx" ON "compliance_alerts" ("transactionId")',
    'CREATE INDEX IF NOT EXISTS "compliance_alerts_ruleCode_idx"      ON "compliance_alerts" ("ruleCode")',
    'CREATE INDEX IF NOT EXISTS "remittance_transactions_status_idx"  ON "remittance_transactions" ("status")',
    'CREATE INDEX IF NOT EXISTS "remittance_transactions_customer_created_idx" ON "remittance_transactions" ("customerId", "createdAt")',
  ];
  for (const sql of indexStatements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn('ensureComplianceColumnsAndTables (index):', e.message);
    }
  }

  // Foreign key: compliance_alerts.transactionId -> remittance_transactions.id
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'compliance_alerts_transactionId_fkey'
        ) THEN
          ALTER TABLE "compliance_alerts"
          ADD CONSTRAINT "compliance_alerts_transactionId_fkey"
          FOREIGN KEY ("transactionId")
          REFERENCES "remittance_transactions"("id")
          ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  } catch (e) {
    console.warn('ensureComplianceColumnsAndTables (fk):', e.message);
  }
}

// Ensure customer_notifications table exists
async function ensureCustomerNotificationsTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "customer_notifications" (
        "id" TEXT NOT NULL,
        "customerId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "imageUrl" TEXT,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "readAt" TIMESTAMP(3),
        CONSTRAINT "customer_notifications_pkey" PRIMARY KEY ("id")
      )
    `);
    
    // Add foreign key constraint if it doesn't exist
    try {
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'customer_notifications_customerId_fkey'
          ) THEN
            ALTER TABLE "customer_notifications" 
            ADD CONSTRAINT "customer_notifications_customerId_fkey" 
            FOREIGN KEY ("customerId") 
            REFERENCES "customers"("id") 
            ON DELETE CASCADE;
          END IF;
        END $$;
      `);
    } catch (fkErr) {
      console.warn('ensureCustomerNotificationsTable (foreign key):', fkErr.message);
    }
  } catch (e) {
    console.warn('ensureCustomerNotificationsTable:', e.message);
  }
}

/** Prisma upsert on sectionType needs a unique DB constraint; add it if missing. */
async function ensureManageContentSectionTypeUnique() {
  try {
    await prisma.$executeRawUnsafe(`
      DELETE FROM "manage_content" mc
      WHERE mc.id NOT IN (
        SELECT DISTINCT ON ("sectionType") id
        FROM "manage_content"
        ORDER BY "sectionType", "updatedAt" DESC
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "manage_content_sectionType_key"
      ON "manage_content" ("sectionType")
    `);
    console.log('✅ manage_content.sectionType unique index ready');
  } catch (e) {
    console.warn('ensureManageContentSectionTypeUnique:', e.message);
  }
}

async function ensureLegalDocumentsTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "legal_documents" (
        "id" TEXT NOT NULL,
        "docType" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "sections" JSONB NOT NULL,
        "effectiveDate" TIMESTAMP(3),
        "contactEmail" TEXT NOT NULL DEFAULT 'legal@onezapay.com',
        "status" TEXT NOT NULL DEFAULT 'published',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "legal_documents_docType_key"
      ON "legal_documents" ("docType")
    `);
  } catch (e) {
    console.warn('ensureLegalDocumentsTable:', e.message);
  }
}

// Handle Prisma Client connection (columns are ensured on first connect)
prisma.$connect()
  .then(() => {
    console.log('✅ Prisma Client connected to database');
    return ensureLevelAndBalanceLimitColumns();
  })
  .then(() => ensureCustomerNotificationsTable())
  .then(() => ensureComplianceColumnsAndTables())
  .then(() => ensureManageContentSectionTypeUnique())
  .then(() => ensureLegalDocumentsTable())
  .catch((error) => {
    console.error('❌ Failed to connect to database:', error);
  });

export default prisma;
export {
  ensureLevelAndBalanceLimitColumns,
  ensureLevelsTable,
  ensureRegistrationSettingsTable,
  ensureCustomerNotificationsTable,
  ensureComplianceColumnsAndTables,
  ensureManageContentSectionTypeUnique,
  ensureLegalDocumentsTable,
};

