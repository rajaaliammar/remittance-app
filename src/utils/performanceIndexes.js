/**
 * Performance index definitions — kept in sync with prisma/add_performance_indexes.sql
 * and prisma/schema.prisma @@index declarations.
 */
export const PERFORMANCE_INDEX_STATEMENTS = [
  // customers (email/username already UNIQUE)
  'CREATE INDEX IF NOT EXISTS "customers_status_idx" ON "customers" ("status")',
  'CREATE INDEX IF NOT EXISTS "customers_createdAt_idx" ON "customers" ("createdAt")',
  'CREATE INDEX IF NOT EXISTS "customers_status_createdAt_idx" ON "customers" ("status", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "customers_phone_idx" ON "customers" ("phone")',
  'CREATE INDEX IF NOT EXISTS "customers_telephone_idx" ON "customers" ("telephone")',

  // backoffice_users
  'CREATE INDEX IF NOT EXISTS "backoffice_users_status_idx" ON "backoffice_users" ("status")',
  'CREATE INDEX IF NOT EXISTS "backoffice_users_createdAt_idx" ON "backoffice_users" ("createdAt")',
  'CREATE INDEX IF NOT EXISTS "backoffice_users_status_createdAt_idx" ON "backoffice_users" ("status", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "backoffice_users_phone_idx" ON "backoffice_users" ("phone")',

  // agents
  'CREATE INDEX IF NOT EXISTS "agents_status_idx" ON "agents" ("status")',
  'CREATE INDEX IF NOT EXISTS "agents_createdAt_idx" ON "agents" ("createdAt")',
  'CREATE INDEX IF NOT EXISTS "agents_status_createdAt_idx" ON "agents" ("status", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "agents_phone_idx" ON "agents" ("phone")',

  // remittance_transactions
  'CREATE INDEX IF NOT EXISTS "remittance_transactions_status_idx" ON "remittance_transactions" ("status")',
  'CREATE INDEX IF NOT EXISTS "remittance_transactions_createdAt_idx" ON "remittance_transactions" ("createdAt")',
  'CREATE INDEX IF NOT EXISTS "remittance_transactions_customerId_idx" ON "remittance_transactions" ("customerId")',
  'CREATE INDEX IF NOT EXISTS "remittance_transactions_customer_created_idx" ON "remittance_transactions" ("customerId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "remittance_transactions_status_createdAt_idx" ON "remittance_transactions" ("status", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "remittance_transactions_transferType_idx" ON "remittance_transactions" ("transferType")',
  'CREATE INDEX IF NOT EXISTS "remittance_transactions_type_idx" ON "remittance_transactions" ("type")',

  // customer_notifications
  'CREATE INDEX IF NOT EXISTS "customer_notifications_customerId_idx" ON "customer_notifications" ("customerId")',
  'CREATE INDEX IF NOT EXISTS "customer_notifications_customerId_sentAt_idx" ON "customer_notifications" ("customerId", "sentAt")',
  'CREATE INDEX IF NOT EXISTS "customer_notifications_customerId_readAt_idx" ON "customer_notifications" ("customerId", "readAt")',

  // compliance_alerts
  'CREATE INDEX IF NOT EXISTS "compliance_alerts_status_idx" ON "compliance_alerts" ("status")',
  'CREATE INDEX IF NOT EXISTS "compliance_alerts_customerId_idx" ON "compliance_alerts" ("customerId")',
  'CREATE INDEX IF NOT EXISTS "compliance_alerts_transactionId_idx" ON "compliance_alerts" ("transactionId")',
  'CREATE INDEX IF NOT EXISTS "compliance_alerts_ruleCode_idx" ON "compliance_alerts" ("ruleCode")',

  // messages
  'CREATE INDEX IF NOT EXISTS "messages_createdAt_idx" ON "messages" ("createdAt")',
  'CREATE INDEX IF NOT EXISTS "messages_senderId_recipientId_idx" ON "messages" ("senderId", "recipientId")',
  'CREATE INDEX IF NOT EXISTS "messages_recipientId_senderId_idx" ON "messages" ("recipientId", "senderId")',
  'CREATE INDEX IF NOT EXISTS "messages_senderId_createdAt_idx" ON "messages" ("senderId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "messages_recipientId_createdAt_idx" ON "messages" ("recipientId", "createdAt")',

  // payment_methods
  'CREATE INDEX IF NOT EXISTS "payment_methods_customerId_idx" ON "payment_methods" ("customerId")',

  // accounting_entries
  'CREATE INDEX IF NOT EXISTS "accounting_entries_createdAt_idx" ON "accounting_entries" ("createdAt")',
  'CREATE INDEX IF NOT EXISTS "accounting_entries_remittanceTransactionId_idx" ON "accounting_entries" ("remittanceTransactionId")',

  // countries / blogs
  'CREATE INDEX IF NOT EXISTS "countries_status_idx" ON "countries" ("status")',
  'CREATE INDEX IF NOT EXISTS "countries_continentId_idx" ON "countries" ("continentId")',
  'CREATE INDEX IF NOT EXISTS "blogs_status_idx" ON "blogs" ("status")',
  'CREATE INDEX IF NOT EXISTS "blogs_createdAt_idx" ON "blogs" ("createdAt")',
  'CREATE INDEX IF NOT EXISTS "blogs_categoryId_idx" ON "blogs" ("categoryId")',

  // orchestration
  'CREATE INDEX IF NOT EXISTS "orchestration_jobs_customerId_idx" ON "orchestration_jobs" ("customerId")',
  'CREATE INDEX IF NOT EXISTS "orchestration_jobs_status_idx" ON "orchestration_jobs" ("status")',
  'CREATE INDEX IF NOT EXISTS "orchestration_jobs_createdAt_idx" ON "orchestration_jobs" ("createdAt")',
];

export async function ensurePerformanceIndexes(prisma) {
  for (const sql of PERFORMANCE_INDEX_STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn('ensurePerformanceIndexes:', e.message);
    }
  }
}
