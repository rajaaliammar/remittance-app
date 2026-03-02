import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Chart of Accounts for a Remittance (MSB) Business
 * 
 * Core accounts:
 *   1000 - Cash (Collection)           → Money received from customers
 *   1100 - Settlement Clearing         → Funds sent to payout partners / banks
 *   2000 - Remittance Payable          → Obligation to deliver funds to recipients
 *   4000 - Fee Revenue                 → Transfer fees earned
 *
 * Run with: node prisma/seed-accounts.js
 */

const chartOfAccounts = [
  // ─── Assets (1000-1999) ───
  { accountCode: '1000', accountName: 'Cash (Collection)',         accountType: 'asset' },
  { accountCode: '1100', accountName: 'Settlement Clearing',       accountType: 'asset' },
  { accountCode: '1200', accountName: 'Customer Wallets',          accountType: 'asset' },
  { accountCode: '1300', accountName: 'Agent Wallets',             accountType: 'asset' },
  { accountCode: '1400', accountName: 'Bank Accounts',             accountType: 'asset' },
  { accountCode: '1500', accountName: 'Prepaid Expenses',          accountType: 'asset' },
  { accountCode: '1600', accountName: 'Fixed Assets',              accountType: 'asset' },

  // ─── Liabilities (2000-2999) ───
  { accountCode: '2000', accountName: 'Remittance Payable',        accountType: 'liability' },
  { accountCode: '2100', accountName: 'Agent Commissions Payable', accountType: 'liability' },
  { accountCode: '2200', accountName: 'Refunds Payable',           accountType: 'liability' },
  { accountCode: '2300', accountName: 'Tax Payable',               accountType: 'liability' },
  { accountCode: '2400', accountName: 'Accrued Expenses',          accountType: 'liability' },
  { accountCode: '2500', accountName: 'Customer Deposits',         accountType: 'liability' },

  // ─── Equity (3000-3999) ───
  { accountCode: '3000', accountName: 'Owner Equity',              accountType: 'equity' },
  { accountCode: '3100', accountName: 'Retained Earnings',         accountType: 'equity' },
  { accountCode: '3200', accountName: 'Current Year Earnings',     accountType: 'equity' },

  // ─── Revenue (4000-4999) ───
  { accountCode: '4000', accountName: 'Fee Revenue',               accountType: 'revenue' },
  { accountCode: '4100', accountName: 'Service Fees Revenue',      accountType: 'revenue' },
  { accountCode: '4200', accountName: 'Commission Revenue',        accountType: 'revenue' },
  { accountCode: '4300', accountName: 'Exchange Rate Gain',        accountType: 'revenue' },
  { accountCode: '4400', accountName: 'Other Revenue',             accountType: 'revenue' },

  // ─── Expenses (5000-5999) ───
  { accountCode: '5000', accountName: 'Gateway / Corridor Fees',   accountType: 'expense' },
  { accountCode: '5100', accountName: 'Payment Processing Fees',   accountType: 'expense' },
  { accountCode: '5200', accountName: 'Agent Commissions',         accountType: 'expense' },
  { accountCode: '5300', accountName: 'Operational Costs',         accountType: 'expense' },
  { accountCode: '5400', accountName: 'Refunds Expense',           accountType: 'expense' },
  { accountCode: '5500', accountName: 'Exchange Rate Loss',        accountType: 'expense' },
  { accountCode: '5600', accountName: 'Administrative Expenses',   accountType: 'expense' },
  { accountCode: '5700', accountName: 'Marketing Expenses',        accountType: 'expense' },
  { accountCode: '5800', accountName: 'Other Expenses',            accountType: 'expense' },
];

async function seedAccounts() {
  console.log('🌱 Seeding / Updating Chart of Accounts...\n');

  try {
    for (const account of chartOfAccounts) {
      // Upsert: create if missing, update name/description if exists
      await prisma.accountingAccount.upsert({
        where: { accountCode: account.accountCode },
        update: {
          accountName: account.accountName,
          accountType: account.accountType,
        },
        create: account,
      });
      console.log(`✅ ${account.accountCode} - ${account.accountName} (${account.accountType})`);
    }

    console.log('\n✨ Chart of Accounts seeding completed!');
  } catch (error) {
    console.error('❌ Error seeding accounts:', error);
    throw error;
  }
}

// Run if called directly
seedAccounts()
  .then(async () => {
    console.log('✅ Seeding completed successfully');
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('❌ Seeding failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
