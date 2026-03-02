import prisma from './prisma.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Company base / operating currency – all accounting entries are recorded in this. */
const BASE_CURRENCY = 'USD';

/** Normalize currency: "$" and "USD" both become "USD". */
function normCurrency(c) {
  const s = String(c || 'USD').trim().toUpperCase();
  return s === '$' ? 'USD' : s;
}

// ─── Account code → id cache (process-lifetime) ───────────────────────────
const _accountIdCache = {};
async function resolveAccountId(accountCode) {
  if (!accountCode) return undefined;
  if (_accountIdCache[accountCode] !== undefined) return _accountIdCache[accountCode] || undefined;
  try {
    if (!prisma.accountingAccount || typeof prisma.accountingAccount.findUnique !== 'function') return undefined;
    const acc = await prisma.accountingAccount.findUnique({ where: { accountCode }, select: { id: true } });
    _accountIdCache[accountCode] = acc?.id ?? null;
    return acc?.id ?? undefined;
  } catch {
    return undefined;
  }
}

// ─── Chart of Accounts mapping ────────────────────────────────────────────
// Must stay in sync with prisma/seed-accounts.js
const ACCT = {
  CASH:                '1000', // Cash (Collection)         – Asset
  SETTLEMENT_CLEARING: '1100', // Settlement Clearing       – Asset
  CUSTOMER_WALLETS:    '1200', // Customer Wallets          – Asset
  REMITTANCE_PAYABLE:  '2000', // Remittance Payable        – Liability
  TAX_PAYABLE:         '2300', // Tax Payable               – Liability
  FEE_REVENUE:         '4000', // Fee Revenue               – Revenue
  COMMISSION_REVENUE:  '4200', // Commission Revenue        – Revenue
  GATEWAY_FEES:        '5000', // Gateway / Corridor Fees   – Expense
  OPERATIONAL_COSTS:   '5300', // Operational Costs         – Expense
  REFUNDS_EXPENSE:     '5400', // Refunds Expense           – Expense
};

// ─────────────────────────────────────────────────────────────────────────────
// Fee / Expense helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get fee amount from a remittance transaction (from recipientInfo, paymentFieldValues, or feeBreakdown).
 */
export const getTransactionFeeAmount = (transaction) => {
  const recipientInfo = transaction.recipientInfo && typeof transaction.recipientInfo === 'object'
    ? transaction.recipientInfo : {};
  const paymentFieldValues = transaction.paymentFieldValues && typeof transaction.paymentFieldValues === 'object'
    ? transaction.paymentFieldValues : {};
  let fee = Number(recipientInfo.fee ?? paymentFieldValues.charge ?? paymentFieldValues.fee ?? 0);
  if (fee === 0 && Array.isArray(recipientInfo.feeBreakdown)) {
    fee = recipientInfo.feeBreakdown.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }
  if (fee === 0 && Array.isArray(paymentFieldValues.feeBreakdown)) {
    fee = paymentFieldValues.feeBreakdown.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }
  return fee;
};

export const calculateTransactionRevenue = (transaction) => getTransactionFeeAmount(transaction);

export const calculateTransactionExpense = (transaction) => {
  const pv = transaction.paymentFieldValues && typeof transaction.paymentFieldValues === 'object'
    ? transaction.paymentFieldValues : {};
  return Number(pv.gatewayFee ?? pv.gateway_fee ?? 0);
};

// ─────────────────────────────────────────────────────────────────────────────
// CORE: Create journal entries when a remittance transaction is created
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create proper double-entry journal entries for a new remittance transaction.
 *
 * Example: Customer sends $300, fee = $30, tax = $0
 *
 *   When customer pays (Status: Processing):
 *     Dr  1000 Cash (Collection)         $330   ← total collected from customer
 *        Cr  2000 Remittance Payable     $300   ← obligation to deliver to recipient
 *        Cr  4000 Fee Revenue            $30    ← fee earned
 *
 *   (Optional) If tax:
 *        Cr  2300 Tax Payable            $X     ← tax owed to government
 *
 *   (Optional) If gateway/corridor expense:
 *     Dr  5000 Gateway Fees              $Y     ← cost to process
 *        Cr  1000 Cash                   $Y
 *
 * @param {Object} transaction - Created RemittanceTransaction
 * @param {string} [status='pending'] - Entry status
 * @param {Object} [opts] - { totalCharge, tax, fee, gatewayFee }
 */
export const createAccountingEntryFromTransaction = async (transaction, status = 'pending', opts = {}) => {
  if (!prisma.accountingEntry || typeof prisma.accountingEntry.create !== 'function') {
    console.warn('[Accounting] Skipped: accounting_entries table not available.');
    return;
  }

  const sendAmount = Number(transaction.sendAmount ?? 0);
  const receiveCurrency = normCurrency(transaction.currency || 'USD');
  const totalCharge = opts.totalCharge != null ? Number(opts.totalCharge) : getTransactionFeeAmount(transaction);
  const taxAmount = opts.tax != null ? Number(opts.tax) : 0;
  const feeAmount = opts.fee != null ? Number(opts.fee) : (totalCharge - taxAmount);
  const expenseAmount = opts.gatewayFee != null ? Number(opts.gatewayFee) : calculateTransactionExpense(transaction);

  // Total collected from customer = principal (sendAmount) + fee + tax
  const totalCollected = sendAmount + feeAmount + taxAmount;

  const common = {
    referenceType: 'remittance_transaction',
    referenceId: transaction.id,
    remittanceTransactionId: transaction.id,
    currency: BASE_CURRENCY,
    status,
  };

  const entries = [];

  // ── 1. Dr Cash (total collected from customer) ──
  if (totalCollected > 0) {
    entries.push({
      ...common,
      entryType: 'revenue',          // maps to Asset account via category
      category: 'cash_collection',
      amount: totalCollected,
      description: `Cash collected – ${transaction.transferType || 'bank'} transfer ($${sendAmount} + $${feeAmount} fee${taxAmount ? ` + $${taxAmount} tax` : ''} → ${receiveCurrency})`,
      _accountCode: ACCT.CASH,
    });
  }

  // ── 2. Cr Remittance Payable (principal owed to recipient) ──
  if (sendAmount > 0) {
    entries.push({
      ...common,
      entryType: 'expense',          // maps to Liability account via category
      category: 'remittance_payable',
      amount: sendAmount,
      description: `Remittance payable – ${transaction.transferType || 'bank'} transfer to ${receiveCurrency}`,
      _accountCode: ACCT.REMITTANCE_PAYABLE,
    });
  }

  // ── 3. Cr Fee Revenue ──
  if (feeAmount > 0) {
    entries.push({
      ...common,
      entryType: 'revenue',
      category: 'transaction_fee',
      amount: feeAmount,
      description: `Fee revenue – ${transaction.transferType || 'bank'} transfer`,
      _accountCode: ACCT.FEE_REVENUE,
    });
  }

  // ── 4. Cr Tax Payable (if any) ──
  if (taxAmount > 0) {
    entries.push({
      ...common,
      entryType: 'revenue',
      category: 'tax',
      amount: taxAmount,
      description: `Tax collected – ${transaction.transferType || 'bank'} transfer`,
      _accountCode: ACCT.TAX_PAYABLE,
    });
  }

  // ── 5. Gateway / corridor expense (optional) ──
  if (expenseAmount > 0) {
    entries.push({
      ...common,
      entryType: 'expense',
      category: 'gateway_fee',
      amount: expenseAmount,
      description: `Gateway fee – ${transaction.gatewayName || 'Gateway'}`,
      _accountCode: ACCT.GATEWAY_FEES,
    });
  }

  // ── Fallback: if no breakdown at all, still record transaction ──
  if (entries.length === 0 && sendAmount > 0) {
    entries.push({
      ...common,
      entryType: 'revenue',
      category: 'cash_collection',
      amount: sendAmount,
      description: `Remittance – ${transaction.transferType || 'bank'} transfer ($${sendAmount} ${BASE_CURRENCY})`,
      _accountCode: ACCT.FEE_REVENUE,
    });
  }

  // Persist entries (resolve accountId)
  for (const entry of entries) {
    const accountCode = entry._accountCode;
    delete entry._accountCode;
    const accountId = await resolveAccountId(accountCode);
    if (accountId) entry.accountId = accountId;
    await prisma.accountingEntry.create({ data: entry });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Status-based journal entries (Completed / Failed / Refunded)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update accounting entries when a transaction status changes.
 *
 * ── Completed ──
 *   Mark original entries as "completed".
 *   Post settlement entries:
 *     Dr  2000 Remittance Payable     $sendAmount   ← liability cleared
 *        Cr  1100 Settlement Clearing $sendAmount   ← funds sent to payout partner
 *
 * ── Failed / Refunded / Canceled ──
 *   Mark original entries as "reversed".
 *   Post reversal entries:
 *     Dr  2000 Remittance Payable     $sendAmount   ← liability cleared
 *     Dr  4000 Fee Revenue            $fee          ← fee reversed
 *        Cr  1000 Cash                $total        ← refund to customer
 *
 * @param {string} transactionId
 * @param {string} newStatus
 */
export const updateAccountingEntriesForTransactionStatus = async (transactionId, newStatus) => {
  if (!prisma.accountingEntry || typeof prisma.accountingEntry.updateMany !== 'function') return;

  const statusLower = (newStatus || '').toLowerCase();

  // Fetch the transaction for amounts
  let transaction = null;
  try {
    transaction = await prisma.remittanceTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, sendAmount: true, currency: true, transferType: true, recipientInfo: true, paymentFieldValues: true },
    });
  } catch { /* ignore if table not available */ }

  const sendAmount = transaction ? Number(transaction.sendAmount ?? 0) : 0;
  const feeAmount = transaction ? getTransactionFeeAmount(transaction) : 0;
  const taxAmount = 0; // TODO: extract from recipientInfo if stored
  const totalCollected = sendAmount + feeAmount + taxAmount;

  const common = {
    referenceType: 'remittance_transaction',
    referenceId: transactionId,
    remittanceTransactionId: transactionId,
    currency: BASE_CURRENCY,
    status: 'completed',
  };

  // ── COMPLETED: settle the liability ──
  if (statusLower === 'completed') {
    // Mark original entries completed
    await prisma.accountingEntry.updateMany({
      where: { remittanceTransactionId: transactionId },
      data: { status: 'completed' },
    });

    // Post settlement: Dr Remittance Payable, Cr Settlement Clearing
    if (sendAmount > 0) {
      const payableId = await resolveAccountId(ACCT.REMITTANCE_PAYABLE);
      const settlementId = await resolveAccountId(ACCT.SETTLEMENT_CLEARING);

      // Dr Remittance Payable (clear liability)
      await prisma.accountingEntry.create({
        data: {
          ...common,
          entryType: 'expense',
          category: 'settlement_debit',
          amount: sendAmount,
          description: `Settlement – clear remittance payable`,
          ...(payableId ? { accountId: payableId } : {}),
        },
      });

      // Cr Settlement Clearing (funds disbursed)
      await prisma.accountingEntry.create({
        data: {
          ...common,
          entryType: 'expense',
          category: 'settlement_credit',
          amount: sendAmount,
          description: `Settlement – funds disbursed to payout partner`,
          ...(settlementId ? { accountId: settlementId } : {}),
        },
      });
    }

    return;
  }

  // ── FAILED / REFUNDED / CANCELED: reverse everything ──
  if (['failed', 'refunded', 'canceled'].includes(statusLower)) {
    // Mark original entries as reversed
    await prisma.accountingEntry.updateMany({
      where: { remittanceTransactionId: transactionId },
      data: { status: 'reversed' },
    });

    if (totalCollected > 0) {
      const cashId = await resolveAccountId(ACCT.CASH);
      const payableId = await resolveAccountId(ACCT.REMITTANCE_PAYABLE);
      const revenueId = await resolveAccountId(ACCT.FEE_REVENUE);

      // Dr Remittance Payable (clear liability)
      if (sendAmount > 0) {
        await prisma.accountingEntry.create({
          data: {
            ...common,
            entryType: 'expense',
            category: 'reversal_payable',
            amount: sendAmount,
            description: `Reversal – clear remittance payable (${statusLower})`,
            ...(payableId ? { accountId: payableId } : {}),
          },
        });
      }

      // Dr Fee Revenue (reverse fee)
      if (feeAmount > 0) {
        await prisma.accountingEntry.create({
          data: {
            ...common,
            entryType: 'revenue',
            category: 'reversal_fee',
            amount: feeAmount,
            description: `Reversal – fee revenue reversed (${statusLower})`,
            ...(revenueId ? { accountId: revenueId } : {}),
          },
        });
      }

      // Cr Cash (refund total to customer)
      await prisma.accountingEntry.create({
        data: {
          ...common,
          entryType: 'revenue',
          category: 'reversal_cash',
          amount: totalCollected,
          description: `Reversal – cash refunded to customer (${statusLower})`,
          ...(cashId ? { accountId: cashId } : {}),
        },
      });
    }
  }
};

/**
 * Create refund accounting entries (legacy – kept for backward compat).
 * The new updateAccountingEntriesForTransactionStatus handles this, but
 * older code paths may still call this directly.
 */
export const createRefundAccountingEntries = async (transaction, createdBy = null) => {
  // The reversal logic is now handled inside updateAccountingEntriesForTransactionStatus
  // when status is 'failed' or 'refunded'. This function is kept as a no-op
  // to avoid breaking existing callers.
  console.log(`[Accounting] createRefundAccountingEntries called for ${transaction?.id} – handled by status update`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation helper
// ─────────────────────────────────────────────────────────────────────────────

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
    if (!byTransaction[refId]) {
      byTransaction[refId] = {
        transaction: e.remittanceTransaction,
        entries: [],
        // Revenue / expense totals (fee-specific for reconciliation)
        recordedFeeRevenue: 0,    // Only actual fee entries (category = transaction_fee)
        recordedCashCollected: 0, // Cash collected from customer
        recordedPrincipal: 0,     // Remittance payable (principal owed)
        totalExpense: 0,          // Gateway fees, etc.
      };
    }
    byTransaction[refId].entries.push(e);

    const amt = Number(e.amount);
    const cat = (e.category || '').toLowerCase();

    // Categorise by actual purpose, not just entryType
    if (cat === 'transaction_fee')                          byTransaction[refId].recordedFeeRevenue += amt;
    else if (cat === 'cash_collection' || cat === 'cash_received') byTransaction[refId].recordedCashCollected += amt;
    else if (cat === 'remittance_payable' || cat === 'payout_obligation') byTransaction[refId].recordedPrincipal += amt;
    else if (e.entryType === 'expense' || e.entryType === 'refund') byTransaction[refId].totalExpense += amt;
  }

  const matched = [];
  const unmatched = [];

  for (const [txId, data] of Object.entries(byTransaction)) {
    const tx = data.transaction;
    const expectedFee = tx ? getTransactionFeeAmount(tx) : 0;
    const expectedSendAmount = tx ? Number(tx.sendAmount ?? 0) : 0;
    const expectedTotalCollected = expectedSendAmount + expectedFee;

    // ── Check 1: Fee Revenue must match expected fee ──
    const feeMatch = Math.abs(data.recordedFeeRevenue - expectedFee) < 0.01;

    // ── Check 2: Cash collected must match sendAmount + fee ──
    const cashMatch = Math.abs(data.recordedCashCollected - expectedTotalCollected) < 0.01;

    // ── Check 3: Principal recorded must match sendAmount ──
    const principalMatch = Math.abs(data.recordedPrincipal - expectedSendAmount) < 0.01;

    const issues = [];
    if (!feeMatch) issues.push(`Fee: expected ${expectedFee}, recorded ${data.recordedFeeRevenue}`);
    if (!cashMatch) issues.push(`Cash collected: expected ${expectedTotalCollected}, recorded ${data.recordedCashCollected}`);
    if (!principalMatch) issues.push(`Principal: expected ${expectedSendAmount}, recorded ${data.recordedPrincipal}`);

    const row = {
      transactionId: txId,
      expectedFee,
      recordedFeeRevenue: data.recordedFeeRevenue,
      expectedSendAmount,
      recordedPrincipal: data.recordedPrincipal,
      expectedTotalCollected,
      recordedCashCollected: data.recordedCashCollected,
      issues,
      ...data,
    };

    if (issues.length === 0) {
      matched.push(row);
    } else {
      unmatched.push(row);
    }
  }

  return {
    matched: matched.length,
    unmatched: unmatched.length,
    matchedDetails: matched,
    unmatchedDetails: unmatched,
    totalEntries: entries.length,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Sync: ensure every transaction has accounting entries
// ─────────────────────────────────────────────────────────────────────────────

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

  return result;
};
