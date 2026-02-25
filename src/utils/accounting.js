import prisma from './prisma.js';

/** Normalize currency: "$" and "USD" both become "USD" so dashboard totals match. */
function normCurrency(c) {
  const s = String(c || 'USD').trim().toUpperCase();
  return s === '$' ? 'USD' : s;
}

/**
 * Get fee amount from a remittance transaction (from recipientInfo, paymentFieldValues, or feeBreakdown).
 * @param {Object} transaction - RemittanceTransaction record
 * @returns {number}
 */
export const getTransactionFeeAmount = (transaction) => {
  const recipientInfo = transaction.recipientInfo && typeof transaction.recipientInfo === 'object'
    ? transaction.recipientInfo
    : {};
  const paymentFieldValues = transaction.paymentFieldValues && typeof transaction.paymentFieldValues === 'object'
    ? transaction.paymentFieldValues
    : {};
  let fee = Number(recipientInfo.fee ?? paymentFieldValues.charge ?? paymentFieldValues.fee ?? 0);
  if (fee === 0 && Array.isArray(recipientInfo.feeBreakdown)) {
    fee = recipientInfo.feeBreakdown.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }
  if (fee === 0 && Array.isArray(paymentFieldValues.feeBreakdown)) {
    fee = paymentFieldValues.feeBreakdown.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }
  return fee;
};

/**
 * Calculate revenue from a transaction (fees collected from customer).
 * @param {Object} transaction - RemittanceTransaction record
 * @returns {number}
 */
export const calculateTransactionRevenue = (transaction) => {
  return getTransactionFeeAmount(transaction);
};

/**
 * Calculate expenses for a transaction (e.g. gateway fees from paymentFieldValues.gatewayFee if set).
 * @param {Object} transaction - RemittanceTransaction record
 * @returns {number}
 */
export const calculateTransactionExpense = (transaction) => {
  const paymentFieldValues = transaction.paymentFieldValues && typeof transaction.paymentFieldValues === 'object'
    ? transaction.paymentFieldValues
    : {};
  return Number(paymentFieldValues.gatewayFee ?? paymentFieldValues.gateway_fee ?? 0);
};

/**
 * Create accounting entries from a remittance transaction (on creation).
 * Call after transaction is created: revenue (fee + tax) and optionally expense (gateway fee).
 * Use opts when called from controller so fee/tax are correct even if transaction JSON is not yet parsed.
 * @param {Object} transaction - Created RemittanceTransaction
 * @param {string} [status] - Entry status: "pending" or "completed"
 * @param {Object} [opts] - Optional: { totalCharge, tax, fee } from calculateTransactionFee (ensures app transactions are recorded)
 */
export const createAccountingEntryFromTransaction = async (transaction, status = 'pending', opts = {}) => {
  if (!prisma.accountingEntry || typeof prisma.accountingEntry.create !== 'function') {
    console.warn('[Accounting] createAccountingEntryFromTransaction skipped: accounting_entries table not available. Run: npx prisma db push or add accounting migration then npx prisma generate');
    return;
  }
  const currency = normCurrency(transaction.currency || 'USD');
  const totalCharge = opts.totalCharge != null ? Number(opts.totalCharge) : getTransactionFeeAmount(transaction);
  const taxAmount = opts.tax != null ? Number(opts.tax) : 0;
  const feeAmount = opts.fee != null ? Number(opts.fee) : (totalCharge - taxAmount);
  const entries = [];

  // Revenue: transaction fee (non-tax portion)
  if (feeAmount > 0) {
    entries.push({
      entryType: 'revenue',
      category: 'transaction_fee',
      amount: feeAmount,
      currency,
      description: `Transaction fee - ${transaction.transferType || 'bank'} transfer`,
      referenceType: 'remittance_transaction',
      referenceId: transaction.id,
      remittanceTransactionId: transaction.id,
      status,
    });
  }

  // Revenue: tax (when tax is applied from charge breakdown)
  if (taxAmount > 0) {
    entries.push({
      entryType: 'revenue',
      category: 'tax',
      amount: taxAmount,
      currency,
      description: `Tax - ${transaction.transferType || 'bank'} transfer`,
      referenceType: 'remittance_transaction',
      referenceId: transaction.id,
      remittanceTransactionId: transaction.id,
      status,
    });
  }

  // If no fee/tax breakdown passed but totalCharge > 0, create single revenue entry (backward compatible)
  if (entries.length === 0 && totalCharge > 0) {
    entries.push({
      entryType: 'revenue',
      category: 'transaction_fee',
      amount: totalCharge,
      currency,
      description: `Transaction fee - ${transaction.transferType || 'bank'} transfer`,
      referenceType: 'remittance_transaction',
      referenceId: transaction.id,
      remittanceTransactionId: transaction.id,
      status,
    });
  }

  const expenseAmount = opts.gatewayFee != null ? Number(opts.gatewayFee) : calculateTransactionExpense(transaction);
  if (expenseAmount > 0) {
    entries.push({
      entryType: 'expense',
      category: 'gateway_fee',
      amount: expenseAmount,
      currency,
      description: `Gateway fee - ${transaction.gatewayName || 'Gateway'}`,
      referenceType: 'remittance_transaction',
      referenceId: transaction.id,
      remittanceTransactionId: transaction.id,
      status,
    });
  }

  // So every app transaction appears in portal Accounting / Entries: create one entry when no fee/tax/expense (use sendAmount so dashboard totals include it)
  if (entries.length === 0) {
    const sendAmount = Number(transaction.sendAmount ?? 0);
    entries.push({
      entryType: 'revenue',
      category: 'transaction',
      amount: sendAmount,
      currency,
      description: `Remittance - ${transaction.transferType || 'bank'} transfer${sendAmount ? ` (${sendAmount} ${currency})` : ''}`,
      referenceType: 'remittance_transaction',
      referenceId: transaction.id,
      remittanceTransactionId: transaction.id,
      status,
    });
  }

  for (const entry of entries) {
    await prisma.accountingEntry.create({ data: entry });
  }
};

/**
 * Update accounting entries when transaction status changes (e.g. Completed -> mark entries completed; Refunded -> reversal).
 * @param {string} transactionId - RemittanceTransaction id
 * @param {string} newStatus - New transaction status (Completed, Failed, Refunded, etc.)
 */
export const updateAccountingEntriesForTransactionStatus = async (transactionId, newStatus) => {
  if (!prisma.accountingEntry || typeof prisma.accountingEntry.updateMany !== 'function') {
    return;
  }
  const statusLower = (newStatus || '').toLowerCase();
  if (statusLower === 'completed') {
    await prisma.accountingEntry.updateMany({
      where: { remittanceTransactionId: transactionId },
      data: { status: 'completed' },
    });
    return;
  }
  if (statusLower === 'failed' || statusLower === 'refunded' || statusLower === 'canceled') {
    await prisma.accountingEntry.updateMany({
      where: { remittanceTransactionId: transactionId },
      data: { status: 'reversed' },
    });
  }
};

/**
 * Create reversal/refund entries when a transaction is refunded.
 * @param {Object} transaction - RemittanceTransaction being refunded
 * @param {string} [createdBy] - BackofficeUser id for audit
 */
export const createRefundAccountingEntries = async (transaction, createdBy = null) => {
  if (!prisma.accountingEntry || typeof prisma.accountingEntry.create !== 'function') {
    return;
  }
  const feeAmount = getTransactionFeeAmount(transaction);
  const currency = normCurrency(transaction.currency || 'USD');
  if (feeAmount > 0) {
    await prisma.accountingEntry.create({
      data: {
        entryType: 'refund',
        category: 'transaction_fee_refund',
        amount: -feeAmount,
        currency,
        description: `Refund - transaction ${transaction.id}`,
        referenceType: 'remittance_transaction',
        referenceId: transaction.id,
        remittanceTransactionId: transaction.id,
        status: 'completed',
        createdBy,
      },
    });
  }
};

/**
 * Reconciliation: find accounting entries that reference remittance transactions and compare totals.
 * Returns summary of matched/unmatched and any discrepancies.
 * @param {Object} [opts] - { startDate, endDate }
 * @returns {Promise<Object>}
 */
export const reconcileAccountingEntries = async (opts = {}) => {
  const { startDate, endDate } = opts;
  const where = {};
  if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
  if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

  const entries = await prisma.accountingEntry.findMany({
    where: { ...where, referenceType: 'remittance_transaction', referenceId: { not: null } },
    include: { remittanceTransaction: true },
  });

  const byTransaction = {};
  for (const e of entries) {
    const refId = e.referenceId || e.remittanceTransactionId;
    if (!refId) continue;
    if (!byTransaction[refId]) byTransaction[refId] = { transaction: e.remittanceTransaction, entries: [], totalRevenue: 0, totalExpense: 0 };
    byTransaction[refId].entries.push(e);
    const amt = Number(e.amount);
    if (e.entryType === 'revenue' || e.entryType === 'fee' || e.entryType === 'commission') byTransaction[refId].totalRevenue += amt;
    if (e.entryType === 'expense' || e.entryType === 'refund') byTransaction[refId].totalExpense += amt;
  }

  const matched = [];
  const unmatched = [];
  for (const [txId, data] of Object.entries(byTransaction)) {
    const expectedFee = data.transaction ? getTransactionFeeAmount(data.transaction) : 0;
    const recordedRevenue = data.totalRevenue;
    const discrepancy = Math.abs(recordedRevenue - expectedFee) > 0.01;
    if (discrepancy) {
      unmatched.push({ transactionId: txId, expectedFee, recordedRevenue, ...data });
    } else {
      matched.push({ transactionId: txId, ...data });
    }
  }

  return {
    matched: matched.length,
    unmatched: unmatched.length,
    matchedDetails: matched,
    unmatchedDetails: unmatched,
    totalEntries: entries.length,
  };
}

/**
 * Sync accounting entries from all remittance transactions.
 * Creates revenue (fee) entries for transactions that don't have any accounting entry yet.
 * Marks existing pending entries as completed when transaction status is Completed.
 * Use this to auto-fetch "all entries from transaction" so expenses, revenue, tax are calculated automatically.
 * @param {Object} [opts] - { startDate, endDate } optional date filter for transactions
 * @returns {Promise<{ created: number, updated: number, skipped: number, errors: string[] }>}
 */
export const syncAccountingEntriesFromTransactions = async (opts = {}) => {
  const result = { created: 0, updated: 0, skipped: 0, errors: [] };
  if (!prisma.accountingEntry || typeof prisma.accountingEntry.create !== 'function') {
    result.errors.push('Accounting module not available');
    return result;
  }
  if (!prisma.remittanceTransaction || typeof prisma.remittanceTransaction.findMany !== 'function') {
    result.errors.push('RemittanceTransaction model not available');
    return result;
  }

  const { startDate, endDate } = opts;
  const where = {};
  if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
  if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

  const transactions = await prisma.remittanceTransaction.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });

  const existingByTxId = await prisma.accountingEntry.findMany({
    where: { referenceType: 'remittance_transaction', referenceId: { not: null } },
    select: { referenceId: true, status: true },
  });
  const hasEntryByTxId = {};
  const pendingByTxId = {};
  for (const e of existingByTxId) {
    const id = e.referenceId || e.remittanceTransactionId;
    if (id) {
      hasEntryByTxId[id] = true;
      if (e.status === 'pending') pendingByTxId[id] = true;
    }
  }

  for (const tx of transactions) {
    const txId = tx.id;
    const statusLower = (tx.status || '').toLowerCase();
    const isCompleted = statusLower === 'completed';
    const isFailedOrRefunded = ['failed', 'refunded', 'canceled'].includes(statusLower);

    if (isFailedOrRefunded) {
      result.skipped += 1;
      continue;
    }

    if (!hasEntryByTxId[txId]) {
      try {
        const entryStatus = isCompleted ? 'completed' : 'pending';
        await createAccountingEntryFromTransaction(tx, entryStatus);
        result.created += 1;
      } catch (err) {
        result.errors.push(`Tx ${txId}: ${err.message || 'create failed'}`);
      }
      continue;
    }

    if (pendingByTxId[txId] && isCompleted) {
      try {
        await updateAccountingEntriesForTransactionStatus(txId, 'Completed');
        result.updated += 1;
      } catch (err) {
        result.errors.push(`Tx ${txId}: ${err.message || 'update failed'}`);
      }
    } else {
      result.skipped += 1;
    }
  }

  // Backfill: set amount = sendAmount on "transaction" category entries that have amount 0 (so table totals appear correctly)
  const zeroAmountTransactionEntries = await prisma.accountingEntry.findMany({
    where: { category: 'transaction', amount: 0, remittanceTransactionId: { not: null } },
    select: { id: true, remittanceTransactionId: true },
  });
  for (const entry of zeroAmountTransactionEntries) {
    try {
      const tx = await prisma.remittanceTransaction.findUnique({
        where: { id: entry.remittanceTransactionId },
        select: { sendAmount: true },
      });
      if (tx && tx.sendAmount != null) {
        await prisma.accountingEntry.update({
          where: { id: entry.id },
          data: { amount: Number(tx.sendAmount) },
        });
        result.updated += 1;
      }
    } catch (err) {
      result.errors.push(`Entry ${entry.id}: ${err.message || 'backfill failed'}`);
    }
  }

  return result;
}
