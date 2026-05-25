/**
 * Test all LiveEx TMS Transaction APIs + optional save probe.
 * Run: node test-aml-transaction-apis.js
 * Optional: AML_TEST_SYNC_REMITTANCE_ID=<cuid> to test sync on existing row
 */

import dotenv from 'dotenv';
import prisma from './src/utils/prisma.js';
import {
  amlListCustomers,
  amlListTransactions,
  amlGetTransactionStatus,
  amlGetTransactionCaseStatus,
  amlGetTransactionTmsDetails,
  verifyAmlConnectionAtStartup,
} from './src/services/amlProvider.service.js';
import {
  syncRemittanceById,
  submitAmlTransactionStatusUpdate,
} from './src/services/amlTransaction.service.js';

dotenv.config();

function ok(label, raw) {
  const err = Boolean(raw?.isError);
  const code = raw?.messageCode ?? '—';
  const msg = raw?.message ?? '—';
  const icon = err ? '❌' : '✅';
  console.log(`${icon} ${label}`);
  console.log(`   message: ${msg} | code: ${code} | isError: ${err}`);
  return !err;
}

function summarizeListing(raw) {
  const list = raw?.lTransactionStatusListing;
  if (!Array.isArray(list)) {
    console.log('   listing: (not an array)');
    return 0;
  }
  console.log(`   listing count: ${list.length}`);
  if (list[0]) console.log('   first row:', JSON.stringify(list[0]));
  return list.length;
}

async function main() {
  console.log('='.repeat(72));
  console.log('AML Transaction API health check');
  console.log('='.repeat(72));

  const login = await verifyAmlConnectionAtStartup();
  if (!login.ok) {
    console.error('❌ AML login:', login.reason);
    process.exit(1);
  }
  console.log('✅ AML login OK\n');

  console.log('--- Customers (baseline) ---');
  const cust = await amlListCustomers('01/01/2024', '31/12/2026');
  ok('GET /api/Customers/listing', cust);
  const custRows = cust?.customerListingResponse || [];
  console.log(`   customers: ${custRows.length}\n`);

  console.log('--- POST /api/Transactions/listing ---');
  const listRaw = await amlListTransactions({
    startDate: '01/01/2020',
    endDate: '31/12/2030',
    transactionType: 97,
  });
  const listCount = summarizeListing(listRaw);
  ok('POST /api/Transactions/listing', listRaw);

  let trId = listRaw?.lTransactionStatusListing?.[0]?.transaction_Number || '';

  const syncId = process.env.AML_TEST_SYNC_REMITTANCE_ID;
  if (syncId) {
    console.log('\n--- Sync remittance → TMS ---');
    const sync = await syncRemittanceById(syncId);
    console.log(sync.success ? '✅' : '❌', 'syncRemittanceById', JSON.stringify(sync, null, 2));
    if (sync.trIdDisplay) trId = sync.trIdDisplay;
  } else {
    const latest = await prisma.remittanceTransaction.findFirst({
      orderBy: { createdAt: 'desc' },
      include: { customer: true },
    });
    if (latest?.id) {
      console.log('\n--- Sync latest remittance → TMS (save) ---', latest.id);
      const sync = await syncRemittanceById(latest.id);
      console.log(sync.success ? '✅' : '❌', 'syncRemittanceById');
      console.log(JSON.stringify(sync, null, 2));
      if (sync.trIdDisplay) trId = sync.trIdDisplay;
    }
  }

  if (trId) {
    console.log('\n--- Detail APIs for', trId, '---');
    for (const [name, fn] of [
      ['GET status', () => amlGetTransactionStatus(trId)],
      ['GET case-status', () => amlGetTransactionCaseStatus(trId)],
      ['GET tms-details', () => amlGetTransactionTmsDetails(trId)],
    ]) {
      try {
        ok(name, await fn());
      } catch (e) {
        console.log('❌', name, e.message);
      }
    }

    const list2 = await amlListTransactions({
      startDate: '01/01/2020',
      endDate: '31/12/2030',
    });
    console.log('\n--- Listing after save ---');
    summarizeListing(list2);
    ok('POST listing (after save)', list2);

    console.log('\n--- POST /api/Transactions/update-status ---');
    const remarks = process.env.AML_TEST_UPDATE_REMARKS || 'API health check — automated test';
    try {
      const upd = await submitAmlTransactionStatusUpdate({
        transactionRefNo: trId,
        remarks,
      });
      ok('POST /api/Transactions/update-status', upd);
    } catch (e) {
      console.log('❌ POST /api/Transactions/update-status', e.message);
      if (e.data) console.log('   provider:', JSON.stringify(e.data).slice(0, 500));
    }
  } else {
    console.log('\nℹ️  No trIdDisplay to test detail APIs. Set AML_TEST_SYNC_REMITTANCE_ID or create a send from the app.');
  }

  console.log('\n' + '='.repeat(72));
  console.log('Done. Enable sync: AML_TRANSACTION_SYNC_ENABLED=true (default)');
  console.log('='.repeat(72));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
