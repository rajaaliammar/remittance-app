import prisma from '../utils/prisma.js';
import { reconcileAccountingEntries, syncAccountingEntriesFromTransactions } from '../utils/accounting.js';

const ENTRY_TYPES = ['revenue', 'expense', 'fee', 'commission', 'refund'];
const PERIOD_TYPES = ['daily', 'weekly', 'monthly', 'yearly'];

/** True if accounting tables are available (migration run + prisma generate). */
function hasAccountingModel() {
  return prisma.accountingEntry && typeof prisma.accountingEntry.findMany === 'function';
}

/** True if accounting accounts table is available. */
function hasAccountingAccountModel() {
  return prisma.accountingAccount && typeof prisma.accountingAccount.findMany === 'function';
}

/** Coerce Prisma Decimal or number to number for JSON. */
function toNumber(value) {
  if (value == null) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  return Number(value) || 0;
}

/** Normalize currency for comparison: "$" and "USD" count as same so dashboard totals include all dollar entries. */
function normCurrency(c) {
  const s = String(c || 'USD').trim().toUpperCase();
  return s === '$' ? 'USD' : s;
}

/**
 * Build date filter for Prisma where clause (UTC).
 * startDate = start of day; endDate = end of day so same-day entries are included.
 */
function buildDateFilter(startDate, endDate) {
  const filter = {};
  if (startDate) filter.gte = new Date(startDate + 'T00:00:00.000Z');
  if (endDate) filter.lte = new Date(endDate + 'T23:59:59.999Z');
  return Object.keys(filter).length ? filter : undefined;
}

/**
 * GET /api/accounting/summary
 * Summary statistics: total revenue, expenses, fees, profit. Supports date range and grouping.
 */
export const getAccountingSummary = async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'none', entryType, category, currency: queryCurrency = 'USD' } = req.query;
    const currency = normCurrency(queryCurrency);
    if (!hasAccountingModel()) {
      return res.json({
        success: true,
        data: {
          totalRevenue: 0,
          totalExpenses: 0,
          totalFees: 0,
          totalTransactionFee: 0,
          totalTax: 0,
          netProfit: 0,
          profit: 0,
          loss: 0,
          currency: currency || 'USD',
        },
      });
    }
    const dateFilter = buildDateFilter(startDate, endDate);
    const where = {};
    if (dateFilter) where.createdAt = dateFilter;
    if (entryType) where.entryType = entryType;
    if (category) where.category = category;
    where.status = { not: 'reversed' };
    // Fetch all entries (no currency filter) so we can show transaction fee / tax per currency
    const entries = await prisma.accountingEntry.findMany({
      where,
      select: { entryType: true, category: true, amount: true, currency: true, createdAt: true },
    });

    const byCurrency = {};
    let totalRevenue = 0;
    let totalExpenses = 0;
    let totalFees = 0;
    let totalTransactionFee = 0;
    let totalTax = 0;
    const byPeriod = {};
    const transactionFeeByCurrency = {};
    const taxByCurrency = {};
    const revenueByCurrency = {};
    const expensesByCurrency = {};
    const feesByCurrency = {};

    for (const e of entries) {
      const amt = toNumber(e.amount);
      const d = e.createdAt;
      const cur = (e.currency || 'USD').toUpperCase();
      const curNorm = normCurrency(cur);
      const cat = (e.category || '').toLowerCase();
      if (!byCurrency[cur]) byCurrency[cur] = { revenue: 0, expenses: 0, fees: 0, transactionFee: 0, tax: 0 };
      if (e.entryType === 'revenue' || e.entryType === 'fee' || e.entryType === 'commission') {
        byCurrency[cur].revenue += amt;
        revenueByCurrency[cur] = (revenueByCurrency[cur] || 0) + amt;
        totalRevenue += curNorm === currency ? amt : 0;
        if (e.entryType === 'fee') {
          feesByCurrency[cur] = (feesByCurrency[cur] || 0) + amt;
          totalFees += curNorm === currency ? amt : 0;
        }
        if (cat === 'transaction_fee') {
          byCurrency[cur].transactionFee += amt;
          totalTransactionFee += curNorm === currency ? amt : 0;
          transactionFeeByCurrency[cur] = (transactionFeeByCurrency[cur] || 0) + amt;
        } else if (cat === 'tax') {
          byCurrency[cur].tax += amt;
          totalTax += curNorm === currency ? amt : 0;
          taxByCurrency[cur] = (taxByCurrency[cur] || 0) + amt;
        }
      } else if (e.entryType === 'expense' || e.entryType === 'refund') {
        byCurrency[cur].expenses += amt;
        expensesByCurrency[cur] = (expensesByCurrency[cur] || 0) + amt;
        totalExpenses += curNorm === currency ? amt : 0;
      }
      if (groupBy && groupBy !== 'none' && PERIOD_TYPES.includes(groupBy)) {
        const key = getPeriodKey(d, groupBy);
        if (!byPeriod[key]) byPeriod[key] = { revenue: 0, expenses: 0, fees: 0 };
        if (e.entryType === 'revenue' || e.entryType === 'fee' || e.entryType === 'commission') {
          byPeriod[key].revenue += curNorm === currency ? amt : 0;
          if (e.entryType === 'fee') byPeriod[key].fees += curNorm === currency ? amt : 0;
        } else if (e.entryType === 'expense' || e.entryType === 'refund') {
          byPeriod[key].expenses += curNorm === currency ? amt : 0;
        }
      }
    }

    const netProfit = totalRevenue - totalExpenses;
    const profit = netProfit > 0 ? netProfit : 0;
    const loss = netProfit < 0 ? Math.abs(netProfit) : 0;
    // Total Fees (all) = transaction fee + tax + fee-type entries in selected currency (so all fee-related revenue is included)
    const totalFeesAll = totalTransactionFee + totalTax + totalFees;
    const allCurrencies = new Set([
      ...Object.keys(transactionFeeByCurrency),
      ...Object.keys(taxByCurrency),
      ...Object.keys(feesByCurrency),
    ]);
    const feesAllByCurrency = {};
    for (const cur of allCurrencies) {
      const v = (transactionFeeByCurrency[cur] || 0) + (taxByCurrency[cur] || 0) + (feesByCurrency[cur] || 0);
      if (v !== 0) feesAllByCurrency[cur] = v;
    }
    const response = {
      totalRevenue,
      totalExpenses,
      totalFees: totalFeesAll,
      totalTransactionFee,
      totalTax,
      netProfit,
      profit,
      loss,
      currency: currency,
      transactionFeeByCurrency: Object.keys(transactionFeeByCurrency).length ? transactionFeeByCurrency : undefined,
      taxByCurrency: Object.keys(taxByCurrency).length ? taxByCurrency : undefined,
      revenueByCurrency: Object.keys(revenueByCurrency).length ? revenueByCurrency : undefined,
      expensesByCurrency: Object.keys(expensesByCurrency).length ? expensesByCurrency : undefined,
      feesByCurrency: Object.keys(feesByCurrency).length ? feesByCurrency : undefined,
      feesAllByCurrency: Object.keys(feesAllByCurrency).length ? feesAllByCurrency : undefined,
      byPeriod: Object.keys(byPeriod).length ? byPeriod : undefined,
    };
    res.json({ success: true, data: response });
  } catch (error) {
    console.error('getAccountingSummary error:', error);
    if (error.code === 'P2021' || error.meta?.code === 'P2021' || (error.message && error.message.includes('does not exist'))) {
      return res.json({
        success: true,
        data: { totalRevenue: 0, totalExpenses: 0, totalFees: 0, totalTransactionFee: 0, totalTax: 0, netProfit: 0, profit: 0, loss: 0, currency: req.query.currency || 'USD' },
      });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to get accounting summary' });
  }
};

function getPeriodKey(date, periodType) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (periodType === 'daily') return `${y}-${m}-${day}`;
  const startOfWeek = new Date(d);
  startOfWeek.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const ws = startOfWeek.toISOString().slice(0, 10);
  if (periodType === 'weekly') return ws;
  if (periodType === 'monthly') return `${y}-${m}`;
  return `${y}`;
}

/**
 * GET /api/accounting/entries
 * List entries with pagination and filters.
 */
export const getAccountingEntries = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.json({ success: true, data: [], total: 0 });
    }
    const {
      limit = 50,
      offset = 0,
      entryType,
      category,
      startDate,
      endDate,
      status,
      referenceType,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;
    const take = Math.min(parseInt(limit, 10) || 50, 2000);
    const skip = Math.max(parseInt(offset, 10) || 0, 0);
    const where = {};
    if (entryType) where.entryType = entryType;
    if (category) where.category = category;
    if (status) where.status = status;
    if (referenceType) where.referenceType = referenceType;
    const dateFilter = buildDateFilter(startDate, endDate);
    if (dateFilter) where.createdAt = dateFilter;

    const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };
    const [entries, total] = await Promise.all([
      prisma.accountingEntry.findMany({
        where,
        orderBy,
        take,
        skip,
        include: {
          remittanceTransaction: {
            select: {
              id: true,
              sendAmount: true,
              receiveAmount: true,
              status: true,
              transferType: true,
              gatewayName: true,
              type: true,
              customer: {
                select: { id: true, email: true, firstName: true, lastName: true },
              },
            },
          },
        },
      }),
      prisma.accountingEntry.count({ where }),
    ]);

    const data = entries.map((e) => {
      const amount = toNumber(e.amount);
      let debitUser = null;
      let creditUser = null;
      const txn = e.remittanceTransaction;
      if (txn && txn.customer) {
        const customerDisplay = [txn.customer.firstName, txn.customer.lastName].filter(Boolean).join(' ') || txn.customer.email || txn.customer.id;
        const customerInfo = { id: txn.customer.id, email: txn.customer.email, displayName: customerDisplay };
        if (txn.type === 'Sent') {
          debitUser = customerInfo;
          creditUser = { id: null, email: null, displayName: 'Recipient' };
        } else if (txn.type === 'Received') {
          creditUser = customerInfo;
          debitUser = { id: null, email: null, displayName: 'Sender' };
        }
      }
      return {
        ...e,
        amount,
        debitUser,
        creditUser,
      };
    });
    res.json({ success: true, data, total });
  } catch (error) {
    console.error('getAccountingEntries error:', error);
    if (error.code === 'P2021' || error.meta?.code === 'P2021' || (error.message && error.message.includes('does not exist'))) {
      return res.json({ success: true, data: [], total: 0 });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to list entries' });
  }
};

/**
 * GET /api/accounting/debit-credit
 * Total debit and credit values plus per-user breakdown. Clicking Debit/Credit on dashboard can show this.
 */
export const getDebitCreditSummary = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.json({
        success: true,
        data: {
          totalDebit: 0,
          totalCredit: 0,
          currency: req.query.currency || 'USD',
          byDebitedUser: [],
          byCreditedUser: [],
        },
      });
    }
    const { startDate, endDate, currency: queryCurrency = 'USD' } = req.query;
    const currency = normCurrency(queryCurrency);
    const dateFilter = buildDateFilter(startDate, endDate);
    const where = { status: { not: 'reversed' } };
    if (dateFilter) where.createdAt = dateFilter;

    const entries = await prisma.accountingEntry.findMany({
      where,
      select: {
        amount: true,
        currency: true,
        remittanceTransaction: {
          select: {
            type: true,
            customer: {
              select: { id: true, email: true, firstName: true, lastName: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 50000,
    });

    let totalDebit = 0;
    let totalCredit = 0;
    const debitByUser = new Map();
    const creditByUser = new Map();

    for (const e of entries) {
      const amt = toNumber(e.amount);
      const cur = (e.currency || 'USD').toUpperCase();
      const curNorm = normCurrency(cur);
      const amountInReportCurrency = curNorm === currency ? amt : amt; // keep same for now; could convert
      const txn = e.remittanceTransaction;
      let debitUser = null;
      let creditUser = null;
      if (txn && txn.customer) {
        const customerDisplay = [txn.customer.firstName, txn.customer.lastName].filter(Boolean).join(' ') || txn.customer.email || txn.customer.id;
        debitUser = txn.type === 'Sent' ? { id: txn.customer.id, displayName: customerDisplay } : { id: 'sender', displayName: 'Sender' };
        creditUser = txn.type === 'Sent' ? { id: 'recipient', displayName: 'Recipient' } : { id: txn.customer.id, displayName: customerDisplay };
      }
      if (debitUser) {
        totalDebit += amountInReportCurrency;
        const key = debitUser.id || debitUser.displayName;
        if (!debitByUser.has(key)) debitByUser.set(key, { userId: debitUser.id, displayName: debitUser.displayName, total: 0 });
        debitByUser.get(key).total += amountInReportCurrency;
      }
      if (creditUser) {
        totalCredit += amountInReportCurrency;
        const key = creditUser.id || creditUser.displayName;
        if (!creditByUser.has(key)) creditByUser.set(key, { userId: creditUser.id, displayName: creditUser.displayName, total: 0 });
        creditByUser.get(key).total += amountInReportCurrency;
      }
    }

    const byDebitedUser = Array.from(debitByUser.values()).map((o) => ({ ...o, total: Math.round(o.total * 100) / 100 }));
    const byCreditedUser = Array.from(creditByUser.values()).map((o) => ({ ...o, total: Math.round(o.total * 100) / 100 }));

    res.json({
      success: true,
      data: {
        totalDebit: Math.round(totalDebit * 100) / 100,
        totalCredit: Math.round(totalCredit * 100) / 100,
        currency,
        byDebitedUser,
        byCreditedUser,
      },
    });
  } catch (error) {
    console.error('getDebitCreditSummary error:', error);
    if (error.code === 'P2021' || error.meta?.code === 'P2021') {
      return res.json({
        success: true,
        data: { totalDebit: 0, totalCredit: 0, currency: req.query.currency || 'USD', byDebitedUser: [], byCreditedUser: [] },
      });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to get debit/credit summary' });
  }
};

/**
 * POST /api/accounting/entries
 * Create manual accounting entry.
 */
export const createAccountingEntry = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.status(503).json({ success: false, message: 'Accounting module not available. Run: npx prisma migrate dev --name add_accounting_tables && npx prisma generate' });
    }
    const userId = req.user?.id;
    const { entryType, category, amount, currency = 'USD', description, referenceType, referenceId } = req.body || {};
    if (!entryType || !ENTRY_TYPES.includes(entryType)) {
      return res.status(400).json({ success: false, message: 'Valid entryType is required (revenue, expense, fee, commission, refund)' });
    }
    const amt = parseFloat(amount);
    if (isNaN(amt)) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    const entry = await prisma.accountingEntry.create({
      data: {
        entryType,
        category: category || null,
        amount: amt,
        currency: currency || 'USD',
        description: description || null,
        referenceType: referenceType || 'manual',
        referenceId: referenceId || null,
        status: 'completed',
        createdBy: userId || null,
      },
    });
    const io = req.app && req.app.get && req.app.get('io');
    if (io) {
      io.emit('accounting:updated');
    }
    res.status(201).json({
      success: true,
      data: { ...entry, amount: toNumber(entry.amount) },
    });
  } catch (error) {
    console.error('createAccountingEntry error:', error);
    if (error.code === 'P2021' || (error.message && error.message.includes('does not exist'))) {
      return res.status(503).json({
        success: false,
        message: 'Accounting table not found. Run in Remittance_backend: npx prisma db push (to create tables without migrations) or fix migrations then npx prisma migrate dev --name add_accounting_tables',
      });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to create entry' });
  }
};

/**
 * GET /api/accounting/entries/:id
 */
export const getAccountingEntryById = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.status(503).json({ success: false, message: 'Accounting module not available. Run: npx prisma migrate dev && npx prisma generate' });
    }
    const { id } = req.params;
    const entry = await prisma.accountingEntry.findUnique({
      where: { id },
      include: {
        remittanceTransaction: true,
      },
    });
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    const data = { ...entry, amount: toNumber(entry.amount) };
    res.json({ success: true, data });
  } catch (error) {
    console.error('getAccountingEntryById error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get entry' });
  }
};

/**
 * PUT /api/accounting/entries/:id
 */
export const updateAccountingEntry = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.status(503).json({ success: false, message: 'Accounting module not available. Run: npx prisma migrate dev && npx prisma generate' });
    }
    const { id } = req.params;
    const { entryType, category, amount, currency, description, status } = req.body || {};
    const updateData = {};
    if (entryType && ENTRY_TYPES.includes(entryType)) updateData.entryType = entryType;
    if (category !== undefined) updateData.category = category;
    if (amount !== undefined) {
      const amt = parseFloat(amount);
      if (!isNaN(amt)) updateData.amount = amt;
    }
    if (currency) updateData.currency = currency;
    if (description !== undefined) updateData.description = description;
    if (status) updateData.status = status;
    const entry = await prisma.accountingEntry.update({
      where: { id },
      data: updateData,
    });
    const io = req.app && req.app.get && req.app.get('io');
    if (io) io.emit('accounting:updated');
    res.json({
      success: true,
      data: { ...entry, amount: toNumber(entry.amount) },
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    console.error('updateAccountingEntry error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update entry' });
  }
};

/**
 * DELETE /api/accounting/entries/:id
 * Soft delete: set status to reversed (or could add deletedAt if schema extended).
 */
export const deleteAccountingEntry = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.status(503).json({ success: false, message: 'Accounting module not available. Run: npx prisma migrate dev && npx prisma generate' });
    }
    const { id } = req.params;
    await prisma.accountingEntry.update({
      where: { id },
      data: { status: 'reversed' },
    });
    const io = req.app && req.app.get && req.app.get('io');
    if (io) io.emit('accounting:updated');
    res.json({ success: true, message: 'Entry deleted' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Entry not found' });
    }
    console.error('deleteAccountingEntry error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete entry' });
  }
};

/**
 * GET /api/accounting/revenue/breakdown
 * Revenue by transaction type, country, gateway, and over time.
 */
export const getRevenueBreakdown = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.json({ success: true, data: { byTransactionType: {}, byGateway: {}, byCountry: {}, trend: {} } });
    }
    const { startDate, endDate, groupBy = 'entryType' } = req.query;
    const dateFilter = buildDateFilter(startDate, endDate);
    const where = {
      entryType: { in: ['revenue', 'fee', 'commission'] },
      status: { not: 'reversed' },
    };
    if (dateFilter) where.createdAt = dateFilter;

    const entries = await prisma.accountingEntry.findMany({
      where,
      include: {
        remittanceTransaction: {
          select: { transferType: true, gatewayName: true, recipientInfo: true },
        },
      },
    });

    const byTransactionType = {};
    const byGateway = {};
    const byCountry = {};
    const trend = {};

    for (const e of entries) {
      const amt = toNumber(e.amount);
      const tx = e.remittanceTransaction;
      const type = (tx?.transferType || 'bank').toLowerCase();
      byTransactionType[type] = (byTransactionType[type] || 0) + amt;
      const gateway = tx?.gatewayName || 'Unknown';
      byGateway[gateway] = (byGateway[gateway] || 0) + amt;
      let country = 'Unknown';
      if (tx?.recipientInfo && typeof tx.recipientInfo === 'object' && tx.recipientInfo.countryName) {
        country = tx.recipientInfo.countryName;
      }
      byCountry[country] = (byCountry[country] || 0) + amt;
      const key = getPeriodKey(e.createdAt, 'daily');
      trend[key] = (trend[key] || 0) + amt;
    }

    res.json({
      success: true,
      data: {
        byTransactionType,
        byGateway,
        byCountry,
        trend: Object.entries(trend).sort((a, b) => a[0].localeCompare(b[0])).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
      },
    });
  } catch (error) {
    console.error('getRevenueBreakdown error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get revenue breakdown' });
  }
};

/**
 * GET /api/accounting/expense/breakdown
 * Expenses by category, by entry type (expense vs refund), gateway fees, operational costs, refunds.
 */
export const getExpenseBreakdown = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.json({ success: true, data: { byCategory: {}, byEntryType: {}, trend: {} } });
    }
    const { startDate, endDate } = req.query;
    const dateFilter = buildDateFilter(startDate, endDate);
    const where = {
      entryType: { in: ['expense', 'refund'] },
      status: { not: 'reversed' },
    };
    if (dateFilter) where.createdAt = dateFilter;

    const entries = await prisma.accountingEntry.findMany({
      where,
      include: {
        remittanceTransaction: { select: { gatewayName: true } },
      },
    });
    const byCategory = {};
    const byEntryType = { expense: 0, refund: 0 };
    const trend = {};
    for (const e of entries) {
      const amt = toNumber(e.amount);
      const cat = e.category || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + amt;
      if (e.entryType === 'expense') byEntryType.expense += amt;
      else if (e.entryType === 'refund') byEntryType.refund += amt;
      const key = getPeriodKey(e.createdAt, 'daily');
      trend[key] = (trend[key] || 0) + amt;
    }
    const trendSorted = Object.entries(trend).sort((a, b) => a[0].localeCompare(b[0])).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
    res.json({ success: true, data: { byCategory, byEntryType, trend: trendSorted } });
  } catch (error) {
    console.error('getExpenseBreakdown error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get expense breakdown' });
  }
};

/**
 * GET /api/accounting/profit-loss
 * P&L statement with optional period comparison.
 */
export const getProfitLossReport = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.json({ success: true, data: { revenue: 0, expenses: 0, netProfit: 0 } });
    }
    const { startDate, endDate, comparePrevious } = req.query;
    const dateFilter = buildDateFilter(startDate, endDate);
    const where = dateFilter ? { createdAt: dateFilter, status: { not: 'reversed' } } : { status: { not: 'reversed' } };

    const entries = await prisma.accountingEntry.findMany({ where });
    let revenue = 0;
    let expenses = 0;
    for (const e of entries) {
      const amt = toNumber(e.amount);
      if (['revenue', 'fee', 'commission'].includes(e.entryType)) revenue += amt;
      else if (['expense', 'refund'].includes(e.entryType)) expenses += amt;
    }
    const netProfit = revenue - expenses;

    let previous = null;
    if (comparePrevious === 'true' && startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const span = end - start;
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - span);
      const prevEntries = await prisma.accountingEntry.findMany({
        where: {
          createdAt: { gte: prevStart, lte: prevEnd },
          status: { not: 'reversed' },
        },
      });
      let prevRevenue = 0;
      let prevExpenses = 0;
      for (const e of prevEntries) {
        const amt = toNumber(e.amount);
        if (['revenue', 'fee', 'commission'].includes(e.entryType)) prevRevenue += amt;
        else if (['expense', 'refund'].includes(e.entryType)) prevExpenses += amt;
      }
      previous = { revenue: prevRevenue, expenses: prevExpenses, netProfit: prevRevenue - prevExpenses };
    }

    res.json({
      success: true,
      data: {
        revenue,
        expenses,
        netProfit,
        previous,
      },
    });
  } catch (error) {
    console.error('getProfitLossReport error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get P&L report' });
  }
};

/**
 * GET /api/accounting/reconcile
 */
export const getReconciliationReport = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.json({ success: true, data: { matched: 0, unmatched: 0, matchedDetails: [], unmatchedDetails: [], totalEntries: 0 } });
    }
    const { startDate, endDate } = req.query;
    const report = await reconcileAccountingEntries({ startDate, endDate });
    res.json({ success: true, data: report });
  } catch (error) {
    console.error('getReconciliationReport error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get reconciliation report' });
  }
};

/**
 * GET /api/accounting/export
 * Export entries as JSON or CSV. PDF can be generated client-side.
 */
export const exportAccountingData = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      if (req.query.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        return res.send('id,entryType,category,amount,currency,description,referenceType,referenceId,status,createdAt\n');
      }
      return res.json({ success: true, data: [] });
    }
    const { format = 'json', startDate, endDate, entryType, limit = 10000 } = req.query;
    const dateFilter = buildDateFilter(startDate, endDate);
    const where = {};
    if (dateFilter) where.createdAt = dateFilter;
    if (entryType) where.entryType = entryType;
    const take = Math.min(parseInt(limit, 10) || 10000, 50000);
    const entries = await prisma.accountingEntry.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
      include: { remittanceTransaction: { select: { id: true, sendAmount: true, status: true } } },
    });
    const data = entries.map((e) => ({
      ...e,
      amount: toNumber(e.amount),
    }));

    if (format === 'csv') {
      const headers = ['id', 'entryType', 'category', 'amount', 'currency', 'description', 'referenceType', 'referenceId', 'status', 'createdAt', 'remittanceTransactionId'];
      const escapeCsv = (v) => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = data.map((e) =>
        headers.map((h) => {
          let val = e[h];
          if (h === 'remittanceTransactionId' && val == null && e.remittanceTransaction) val = e.remittanceTransaction.id;
          if (h === 'createdAt') return val ? new Date(val).toISOString() : '';
          return escapeCsv(val);
        }).join(','),
      );
      const csv = [headers.join(','), ...rows].join('\n');
      const filename = `accounting-export-${startDate || 'all'}-${endDate || 'all'}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send('\uFEFF' + csv);
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('exportAccountingData error:', error);
    res.status(500).json({ success: false, message: error.message || 'Export failed' });
  }
};

/**
 * POST /api/accounting/sync-from-transactions
 * Auto-fetch accounting entries from all remittance transactions.
 * Creates revenue (fee) entries for transactions that don't have entries yet;
 * marks pending entries as completed when transaction status is Completed.
 * Optional query: startDate, endDate to limit which transactions to sync.
 */
export const syncFromTransactions = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.status(503).json({
        success: false,
        message: 'Accounting module not available. Run: npx prisma migrate dev --name add_accounting_tables && npx prisma generate',
      });
    }
    const { startDate, endDate } = req.query;
    const result = await syncAccountingEntriesFromTransactions({ startDate, endDate });
    const io = req.app && req.app.get && req.app.get('io');
    if (io) {
      io.emit('accounting:updated');
      console.log('[Socket] Emitted accounting:updated after sync-from-transactions');
    }
    res.json({
      success: true,
      data: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length ? result.errors : undefined,
      },
    });
  } catch (error) {
    console.error('syncFromTransactions error:', error);
    res.status(500).json({ success: false, message: error.message || 'Sync failed' });
  }
};

/**
 * POST /api/accounting/backfill-accounts
 * Backfill existing accounting entries: set accountId & fix currency to USD for entries that are missing them.
 */
export const backfillAccountingEntries = async (req, res) => {
  try {
    if (!hasAccountingModel()) return res.json({ success: true, data: { updated: 0 } });

    let updated = 0;

    // 1. Fix currency: change non-USD entries to USD (company base currency)
    const nonUsdEntries = await prisma.accountingEntry.findMany({
      where: { currency: { not: 'USD' } },
      select: { id: true },
    });
    if (nonUsdEntries.length > 0) {
      const result = await prisma.accountingEntry.updateMany({
        where: { currency: { not: 'USD' } },
        data: { currency: 'USD' },
      });
      updated += result.count;
      console.log(`[Accounting Backfill] Fixed currency on ${result.count} entries`);
    }

    // 2. Set accountId on entries that don't have one
    if (hasAccountingAccountModel()) {
      const entriesWithoutAccount = await prisma.accountingEntry.findMany({
        where: { accountId: null },
        select: { id: true, entryType: true, category: true },
      });

      if (entriesWithoutAccount.length > 0) {
        // Build account code → id map
        const allAccounts = await prisma.accountingAccount.findMany({
          select: { id: true, accountCode: true },
        });
        const codeToId = {};
        for (const a of allAccounts) codeToId[a.accountCode] = a.id;

        for (const entry of entriesWithoutAccount) {
          const code = mapEntryToAccount(entry.entryType, entry.category);
          if (code && codeToId[code]) {
            await prisma.accountingEntry.update({
              where: { id: entry.id },
              data: { accountId: codeToId[code] },
            });
            updated++;
          }
        }
        console.log(`[Accounting Backfill] Set accountId on ${entriesWithoutAccount.length} entries`);
      }
    }

    res.json({ success: true, data: { updated } });
  } catch (error) {
    console.error('backfillAccountingEntries error:', error);
    res.status(500).json({ success: false, message: error.message || 'Backfill failed' });
  }
};

/**
 * GET /api/accounting/general-ledger
 * Get general ledger view with all accounts, showing debits, credits, and balances.
 * Supports filtering by date range, account type, account code, and currency.
 */
export const getGeneralLedger = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.json({ success: true, data: { accounts: [], summary: { totalDebits: 0, totalCredits: 0, totalBalance: 0, currency: req.query.currency || 'USD', accountCount: 0 } } });
    }

    // Check if AccountingAccount model exists (requires migration)
    if (!hasAccountingAccountModel()) {
      return res.status(503).json({
        success: false,
        message: 'Chart of Accounts not available. Please run: npx prisma migrate dev --name add_accounting_2_features && npx prisma generate && node prisma/seed-accounts.js',
      });
    }

    const { startDate, endDate, accountType, accountCode, currency: queryCurrency = 'USD', includeZeroBalance = 'false' } = req.query;
    const currency = normCurrency(queryCurrency);
    const dateFilter = buildDateFilter(startDate, endDate);

    // Build where clause for entries
    const entryWhere = { status: { not: 'reversed' } };
    if (dateFilter) entryWhere.createdAt = dateFilter;

    // Get all accounting accounts (chart of accounts)
    const accountWhere = { status: 'active' };
    if (accountType) accountWhere.accountType = accountType;
    if (accountCode) accountWhere.accountCode = { contains: accountCode, mode: 'insensitive' };

    // First, get all entries that match the filters (to handle entries without accountId)
    // Note: We don't select accountId here since it might not exist if migration hasn't been run yet
    // Entries will be mapped to accounts based on category/type instead
    // Rich transaction select – gives us everything the GL detail rows need
    const txSelect = {
      id: true,
      sendAmount: true,
      receiveAmount: true,
      currency: true,
      transferType: true,
      status: true,
      gatewayName: true,
      recipientInfo: true,
      createdAt: true,
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          country: true,
        },
      },
    };

    const entrySelect = {
      id: true,
      entryType: true,
      category: true,
      amount: true,
      currency: true,
      createdAt: true,
      description: true,
      remittanceTransaction: { select: txSelect },
    };

    const allEntries = await prisma.accountingEntry.findMany({
      where: entryWhere,
      select: entrySelect,
    });

    const accounts = await prisma.accountingAccount.findMany({
      where: accountWhere,
      orderBy: [{ accountCode: 'asc' }],
      include: {
        entries: {
          where: entryWhere,
          select: entrySelect,
        },
      },
    });

    // Map all entries to accounts based on category/type (since accountId might not exist yet)
    // This ensures entries appear in the General Ledger even before the migration is run
    const entryIdsInAccounts = new Set();
    accounts.forEach((acc) => {
      acc.entries.forEach((e) => entryIdsInAccounts.add(e.id));
    });

    // Add entries that aren't already linked to accounts
    const entriesToMap = allEntries.filter((e) => !entryIdsInAccounts.has(e.id));
    if (entriesToMap.length > 0) {
      for (const entry of entriesToMap) {
        const mappedAccountCode = mapEntryToAccount(entry.entryType, entry.category);
        if (mappedAccountCode) {
          const account = accounts.find((a) => a.accountCode === mappedAccountCode);
          if (account) {
            account.entries.push(entry);
          }
        }
      }
    }

    // Calculate debits, credits, and balances for each account
    const accountData = [];
    let totalDebits = 0;
    let totalCredits = 0;

    for (const account of accounts) {
      let debits = 0;
      let credits = 0;
      const entries = [];

      for (const entry of account.entries) {
        const amt = toNumber(entry.amount);
        const entryCurrency = normCurrency(entry.currency || 'USD');

        // Only include entries in the selected currency
        if (entryCurrency !== currency) continue;

        // Determine if this is a debit or credit based on account type, entry type, and category
        // Assets and Expenses: increases are debits, decreases are credits
        // Liabilities, Equity, Revenue: increases are credits, decreases are debits
        // Settlement/reversal entries are contra (opposite direction)
        const isDebit = determineDebitCredit(account.accountType, entry.entryType, amt > 0, entry.category);

        if (isDebit) {
          debits += Math.abs(amt);
        } else {
          credits += Math.abs(amt);
        }

        // Build rich transaction detail object
        const tx = entry.remittanceTransaction;
        let transactionDetail = null;
        if (tx) {
          const ri = tx.recipientInfo && typeof tx.recipientInfo === 'object' ? tx.recipientInfo : {};
          const senderName = [tx.customer?.firstName, tx.customer?.lastName].filter(Boolean).join(' ') || tx.customer?.email || '—';
          const recipientName = ri.accountHolderName || ri.recipientName || ri.fullName || '—';
          const recipientCountry = ri.country || ri.recipientCountry || '—';
          transactionDetail = {
            id: tx.id,
            sendAmount: toNumber(tx.sendAmount),
            receiveAmount: toNumber(tx.receiveAmount),
            receiveCurrency: tx.currency || '—',
            transferType: tx.transferType || '—',
            status: tx.status || '—',
            gateway: tx.gatewayName || '—',
            senderName,
            senderCountry: tx.customer?.country || '—',
            recipientName,
            recipientCountry,
            recipientAccount: ri.accountNumber || ri.mobileNumber || ri.walletNumber || '—',
            date: tx.createdAt,
          };
        }

        entries.push({
          id: entry.id,
          date: entry.createdAt,
          entryType: entry.entryType,
          category: entry.category,
          description: entry.description,
          amount: amt,
          currency: entry.currency,
          isDebit,
          debit: isDebit ? Math.abs(amt) : 0,
          credit: isDebit ? 0 : Math.abs(amt),
          transactionId: tx?.id,
          transaction: transactionDetail,
        });
      }

      const balance = debits - credits;

      // Skip accounts with zero balance if requested
      if (includeZeroBalance === 'false' && debits === 0 && credits === 0) continue;

      accountData.push({
        id: account.id,
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        debits: Math.round(debits * 100) / 100,
        credits: Math.round(credits * 100) / 100,
        balance: Math.round(balance * 100) / 100,
        entryCount: entries.length,
        entries: entries.sort((a, b) => new Date(a.date) - new Date(b.date)),
      });

      totalDebits += debits;
      totalCredits += credits;
    }

    // Sort by account code
    accountData.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const summary = {
      totalDebits: Math.round(totalDebits * 100) / 100,
      totalCredits: Math.round(totalCredits * 100) / 100,
      totalBalance: Math.round((totalDebits - totalCredits) * 100) / 100,
      currency,
      accountCount: accountData.length,
    };

    res.json({
      success: true,
      data: {
        accounts: accountData,
        summary,
      },
    });
  } catch (error) {
    console.error('getGeneralLedger error:', error);
    if (error.code === 'P2021' || error.meta?.code === 'P2021' || (error.message && error.message.includes('does not exist'))) {
      return res.json({ success: true, data: { accounts: [], summary: { totalDebits: 0, totalCredits: 0, totalBalance: 0, currency: req.query.currency || 'USD', accountCount: 0 } } });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to get general ledger' });
  }
};

/**
 * Helper function to determine if an entry is a debit or credit.
 *
 * Standard accounting rules:
 *   Assets & Expenses  → positive amount = DEBIT (increase)
 *   Liabilities, Equity, Revenue → positive amount = CREDIT (increase)
 *
 * Contra / settlement / reversal entries go the OPPOSITE direction:
 *   - settlement_debit  on Liability  → DEBIT (reduces liability)
 *   - settlement_credit on Asset      → CREDIT (reduces asset)
 *   - reversal_cash     on Asset      → CREDIT (cash going out)
 *   - reversal_payable  on Liability  → DEBIT (clearing liability)
 *   - reversal_fee      on Revenue    → DEBIT (reversing revenue)
 *
 * @param {string} accountType - Account type (asset, liability, equity, revenue, expense)
 * @param {string} entryType - Entry type (revenue, expense, fee, commission, refund)
 * @param {boolean} isPositive - Whether the amount is positive
 * @param {string} [category] - Entry category (cash_collection, settlement_debit, reversal_cash, etc.)
 * @returns {boolean} - true if debit, false if credit
 */
function determineDebitCredit(accountType, entryType, isPositive, category) {
  const cat = (category || '').toLowerCase();
  const acct = (accountType || '').toLowerCase();

  // ── Contra / settlement entries: flip the normal direction ──
  // Settlement: Dr Remittance Payable (liability debit), Cr Settlement Clearing (asset credit)
  if (cat === 'settlement_debit') return true;   // Always debit (clearing liability)
  if (cat === 'settlement_credit') return false;  // Always credit (asset reduction / funds out)

  // Reversals: opposite of original entry
  if (cat === 'reversal_cash') return false;      // Cr Cash (refund out)
  if (cat === 'reversal_payable') return true;    // Dr Payable (clear obligation)
  if (cat === 'reversal_fee') return true;        // Dr Revenue (reverse fee)

  // ── Standard rules ──
  // Assets and Expenses: increases are debits
  if (acct === 'asset' || acct === 'expense') {
    return isPositive;
  }

  // Liabilities, Equity, Revenue: increases are credits
  if (acct === 'liability' || acct === 'equity' || acct === 'revenue') {
    return !isPositive;
  }

  // Default: positive amounts are debits
  return isPositive;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSIDIARY LEDGER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/accounting/subsidiary-ledger
 *
 * Returns a detailed per-entity breakdown of a GL control account.
 *
 * Query params:
 *   type       = customer | corridor | gateway | agent
 *   startDate  = YYYY-MM-DD
 *   endDate    = YYYY-MM-DD
 *   currency   = USD (default)
 *   status     = all | processing | completed | failed  (optional)
 *   entityId   = optional – return a single entity's detail with running balance
 */
export const getSubsidiaryLedger = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.json({ success: true, data: { type: req.query.type || 'customer', entities: [], summary: {}, reconciliation: {} } });
    }

    const {
      type = 'customer',
      startDate,
      endDate,
      currency: queryCurrency = 'USD',
      status: statusFilter,
      entityId,
    } = req.query;

    const currency = normCurrency(queryCurrency);
    const dateFilter = buildDateFilter(startDate, endDate);

    // Base where: non-reversed entries that reference a remittance transaction
    const entryWhere = {
      status: { not: 'reversed' },
      remittanceTransactionId: { not: null },
    };
    if (dateFilter) entryWhere.createdAt = dateFilter;

    // Fetch all relevant entries with full transaction + customer data
    const entries = await prisma.accountingEntry.findMany({
      where: entryWhere,
      select: {
        id: true,
        entryType: true,
        category: true,
        amount: true,
        currency: true,
        status: true,
        description: true,
        createdAt: true,
        accountId: true,
        agentId: true,
        remittanceTransaction: {
          select: {
            id: true,
            customerId: true,
            sendAmount: true,
            receiveAmount: true,
            currency: true,
            transferType: true,
            gatewayName: true,
            status: true,
            recipientInfo: true,
            createdAt: true,
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                country: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Filter by currency
    const filtered = entries.filter((e) => normCurrency(e.currency) === currency);

    // Optional status filter on the TRANSACTION
    const statusLower = (statusFilter || '').toLowerCase();
    const statusFiltered = statusLower && statusLower !== 'all'
      ? filtered.filter((e) => (e.remittanceTransaction?.status || '').toLowerCase() === statusLower)
      : filtered;

    // ── Group entries by entity key ──
    const groups = new Map(); // key → { entityInfo, entries[], txIds Set }

    for (const entry of statusFiltered) {
      const tx = entry.remittanceTransaction;
      if (!tx) continue;

      const ri = tx.recipientInfo && typeof tx.recipientInfo === 'object' ? tx.recipientInfo : {};
      let groupKey, entityInfo;

      switch (type) {
        case 'corridor': {
          const destCurrency = normCurrency(tx.currency || 'Unknown');
          const destCountry = ri.country || ri.recipientCountry || '—';
          groupKey = `${currency}_${destCurrency}`;
          entityInfo = {
            id: groupKey,
            name: `${currency} → ${destCurrency}`,
            subLabel: destCountry !== '—' ? destCountry : undefined,
            type: 'corridor',
          };
          break;
        }
        case 'gateway': {
          const gw = tx.gatewayName || 'Unknown Gateway';
          groupKey = gw.toLowerCase().replace(/\s+/g, '_');
          entityInfo = {
            id: groupKey,
            name: gw,
            type: 'gateway',
          };
          break;
        }
        case 'agent': {
          const agentId = entry.agentId || 'unassigned';
          groupKey = agentId;
          entityInfo = {
            id: agentId,
            name: agentId === 'unassigned' ? 'Unassigned' : agentId,
            type: 'agent',
          };
          break;
        }
        case 'customer':
        default: {
          const cust = tx.customer;
          groupKey = tx.customerId || 'unknown';
          const custName = cust
            ? [cust.firstName, cust.lastName].filter(Boolean).join(' ') || cust.email || cust.id
            : 'Unknown Customer';
          entityInfo = {
            id: groupKey,
            name: custName,
            email: cust?.email || '—',
            phone: cust?.phone || '—',
            country: cust?.country || '—',
            type: 'customer',
          };
          break;
        }
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { entityInfo, entries: [], txIds: new Set() });
      }
      const g = groups.get(groupKey);
      g.entries.push(entry);
      g.txIds.add(tx.id);
    }

    // ── If entityId is provided, return single entity detail with running balance ──
    if (entityId) {
      const group = groups.get(entityId);
      if (!group) {
        return res.json({ success: true, data: { type, entity: null, transactions: [], runningBalanceEntries: [] } });
      }

      // Build per-transaction detail
      const txMap = new Map();
      for (const entry of group.entries) {
        const tx = entry.remittanceTransaction;
        if (!tx) continue;
        if (!txMap.has(tx.id)) {
          const ri = tx.recipientInfo && typeof tx.recipientInfo === 'object' ? tx.recipientInfo : {};
          txMap.set(tx.id, {
            transactionId: tx.id,
            date: tx.createdAt,
            sendAmount: toNumber(tx.sendAmount),
            receiveAmount: toNumber(tx.receiveAmount),
            receiveCurrency: tx.currency || '—',
            transferType: tx.transferType || '—',
            gateway: tx.gatewayName || '—',
            status: tx.status || '—',
            senderName: group.entityInfo.name,
            recipientName: ri.accountHolderName || ri.recipientName || ri.fullName || '—',
            recipientCountry: ri.country || ri.recipientCountry || '—',
            recipientAccount: ri.accountNumber || ri.mobileNumber || ri.walletNumber || '—',
            fee: 0,
            entries: [],
          });
        }
        const txData = txMap.get(tx.id);
        const amt = toNumber(entry.amount);
        const cat = (entry.category || '').toLowerCase();

        if (cat === 'transaction_fee' || cat === 'tax') txData.fee += amt;

        txData.entries.push({
          id: entry.id,
          date: entry.createdAt,
          category: entry.category,
          entryType: entry.entryType,
          description: entry.description,
          amount: amt,
          currency: entry.currency,
        });
      }

      // Running balance entries (sorted by date, server-calculated)
      const sortedEntries = [...group.entries].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      let runningBalance = 0;
      const runningBalanceEntries = sortedEntries.map((entry) => {
        const amt = toNumber(entry.amount);
        const cat = (entry.category || '').toLowerCase();
        const tx = entry.remittanceTransaction;
        const ri = tx?.recipientInfo && typeof tx.recipientInfo === 'object' ? tx.recipientInfo : {};

        // Determine debit/credit for this entity's perspective
        // Cash in / fee = debit to customer (they pay us)
        // Remittance payable = credit (we owe them payout)
        // Settlement = debit (we settled)
        let debit = 0;
        let credit = 0;
        if (cat === 'cash_collection' || cat === 'cash_received') {
          debit = amt; // Customer paid
        } else if (cat === 'remittance_payable' || cat === 'payout_obligation') {
          credit = amt; // We owe payout
        } else if (cat === 'transaction_fee' || cat === 'tax') {
          debit = amt; // Fee is part of what customer paid
        } else if (cat === 'settlement_debit') {
          debit = amt; // Liability cleared
        } else if (cat === 'settlement_credit') {
          credit = amt; // Funds sent out
        } else if (cat.startsWith('reversal_')) {
          credit = amt; // Reversal
        } else if (cat === 'gateway_fee') {
          credit = amt; // Cost
        } else {
          debit = amt;
        }

        runningBalance += debit - credit;

        return {
          id: entry.id,
          date: entry.createdAt,
          transactionId: tx?.id,
          category: entry.category,
          description: entry.description,
          recipientName: ri.accountHolderName || ri.recipientName || '—',
          sendAmount: tx ? toNumber(tx.sendAmount) : 0,
          receiveAmount: tx ? toNumber(tx.receiveAmount) : 0,
          receiveCurrency: tx?.currency || '—',
          txStatus: tx?.status || '—',
          debit: Math.round(debit * 100) / 100,
          credit: Math.round(credit * 100) / 100,
          runningBalance: Math.round(runningBalance * 100) / 100,
        };
      });

      return res.json({
        success: true,
        data: {
          type,
          entity: group.entityInfo,
          transactionCount: group.txIds.size,
          transactions: Array.from(txMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date)),
          runningBalanceEntries,
        },
      });
    }

    // ── Build summary per entity ──
    const entities = [];
    let grandTotalVolume = 0;
    let grandTotalFees = 0;
    let grandPending = 0;
    let grandSettled = 0;
    let grandTxCount = 0;

    for (const [key, group] of groups) {
      let totalVolume = 0;
      let totalFees = 0;
      let pendingAmount = 0;
      let settledAmount = 0;

      // We calculate per unique transaction to avoid double counting
      const txTotals = new Map();
      for (const entry of group.entries) {
        const tx = entry.remittanceTransaction;
        if (!tx) continue;
        if (!txTotals.has(tx.id)) {
          txTotals.set(tx.id, {
            sendAmount: toNumber(tx.sendAmount),
            receiveAmount: toNumber(tx.receiveAmount),
            status: tx.status,
            fee: 0,
          });
        }
        const cat = (entry.category || '').toLowerCase();
        if (cat === 'transaction_fee' || cat === 'tax') {
          txTotals.get(tx.id).fee += toNumber(entry.amount);
        }
      }

      for (const [, txData] of txTotals) {
        totalVolume += txData.sendAmount;
        totalFees += txData.fee;
        const sl = (txData.status || '').toLowerCase();
        if (sl === 'completed') {
          settledAmount += txData.sendAmount;
        } else if (sl === 'processing' || sl === 'pending') {
          pendingAmount += txData.sendAmount;
        }
      }

      const txCount = group.txIds.size;

      entities.push({
        ...group.entityInfo,
        totalVolume: Math.round(totalVolume * 100) / 100,
        totalFees: Math.round(totalFees * 100) / 100,
        pendingAmount: Math.round(pendingAmount * 100) / 100,
        settledAmount: Math.round(settledAmount * 100) / 100,
        outstandingBalance: Math.round(pendingAmount * 100) / 100,
        transactionCount: txCount,
      });

      grandTotalVolume += totalVolume;
      grandTotalFees += totalFees;
      grandPending += pendingAmount;
      grandSettled += settledAmount;
      grandTxCount += txCount;
    }

    // Sort: by volume descending (top customers / corridors first)
    entities.sort((a, b) => b.totalVolume - a.totalVolume);

    // ── Reconciliation check: compare subsidiary total against GL ──
    let glControlBalance = null;
    try {
      if (hasAccountingAccountModel()) {
        // Remittance Payable (2000) is the control account for customer & corridor ledgers
        const controlCode = type === 'agent' ? '2100' : '2000';
        const controlAccount = await prisma.accountingAccount.findUnique({
          where: { accountCode: controlCode },
          select: { id: true, accountName: true },
        });
        if (controlAccount) {
          const controlEntries = await prisma.accountingEntry.findMany({
            where: {
              accountId: controlAccount.id,
              status: { not: 'reversed' },
              ...(dateFilter ? { createdAt: dateFilter } : {}),
            },
            select: { amount: true, category: true },
          });
          let controlTotal = 0;
          for (const e of controlEntries) {
            controlTotal += toNumber(e.amount);
          }
          glControlBalance = Math.round(controlTotal * 100) / 100;
        }
      }
    } catch { /* ignore reconciliation errors */ }

    const summary = {
      totalVolume: Math.round(grandTotalVolume * 100) / 100,
      totalFees: Math.round(grandTotalFees * 100) / 100,
      pendingPayout: Math.round(grandPending * 100) / 100,
      settledAmount: Math.round(grandSettled * 100) / 100,
      totalTransactions: grandTxCount,
      entityCount: entities.length,
      currency,
    };

    const reconciliation = {
      subsidiaryPendingTotal: Math.round(grandPending * 100) / 100,
      glControlBalance,
      isReconciled: glControlBalance != null ? Math.abs(grandPending - glControlBalance) < 0.01 : null,
      controlAccount: type === 'agent' ? '2100 – Agent Commissions Payable' : '2000 – Remittance Payable',
    };

    return res.json({
      success: true,
      data: { type, entities, summary, reconciliation },
    });
  } catch (error) {
    console.error('[API] getSubsidiaryLedger error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get subsidiary ledger' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CASH FLOW STATEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/accounting/cash-flow
 *
 * Returns a structured Cash Flow Statement with three sections:
 *   1. Operating Activities  – customer collections, fees, payouts, commissions, expenses
 *   2. Investing Activities  – fixed-asset purchases, long-term investments
 *   3. Financing Activities  – equity injections, loan draws / repayments
 *
 * Everything is derived from AccountingEntry (double-entry) — NEVER directly from transactions.
 *
 * Query params:
 *   startDate  = YYYY-MM-DD
 *   endDate    = YYYY-MM-DD
 *   currency   = USD (default)
 *   comparePreviousPeriod = true/false  (optional — adds prior-period comparison)
 */
export const getCashFlowStatement = async (req, res) => {
  try {
    if (!hasAccountingModel()) {
      return res.json({ success: true, data: buildEmptyCashFlow('USD') });
    }

    const {
      startDate,
      endDate,
      currency: queryCurrency = 'USD',
      comparePreviousPeriod,
    } = req.query;

    const currency = normCurrency(queryCurrency);
    const dateFilter = buildDateFilter(startDate, endDate);
    const compare = comparePreviousPeriod === 'true';

    // ── Fetch ALL non-reversed entries for the period ──
    const entryWhere = { status: { not: 'reversed' } };
    if (dateFilter) entryWhere.createdAt = dateFilter;

    const allEntries = await prisma.accountingEntry.findMany({
      where: entryWhere,
      select: {
        id: true,
        entryType: true,
        category: true,
        amount: true,
        currency: true,
        createdAt: true,
        description: true,
        accountId: true,
      },
    });

    // Filter to target currency
    const entries = allEntries.filter((e) => normCurrency(e.currency) === currency);

    // Also fetch account info so we can classify by accountType / accountCode
    let accountMap = new Map(); // accountId → { accountCode, accountType, accountName }
    if (hasAccountingAccountModel()) {
      const accounts = await prisma.accountingAccount.findMany({
        select: { id: true, accountCode: true, accountType: true, accountName: true },
      });
      for (const a of accounts) {
        accountMap.set(a.id, a);
      }
    }

    // ── Classify every entry into cash-flow buckets ──
    const buckets = {
      // Operating
      cashCollectedFromCustomers: 0,
      feesEarned: 0,
      payoutsToPartners: 0,
      agentCommissionsPaid: 0,
      refundsIssued: 0,
      operatingExpenses: 0,
      gatewayFees: 0,
      taxCollected: 0,
      changeInRemittancePayable: 0,
      // Investing
      equipmentPurchased: 0,
      softwareInvestment: 0,
      otherInvesting: 0,
      // Financing
      investorCapital: 0,
      loanReceived: 0,
      loanRepayment: 0,
      otherFinancing: 0,
    };

    // Track entries per bucket for the detail drill-down
    const bucketEntries = {
      cashCollectedFromCustomers: [],
      feesEarned: [],
      payoutsToPartners: [],
      agentCommissionsPaid: [],
      refundsIssued: [],
      operatingExpenses: [],
      gatewayFees: [],
      taxCollected: [],
      changeInRemittancePayable: [],
      equipmentPurchased: [],
      softwareInvestment: [],
      otherInvesting: [],
      investorCapital: [],
      loanReceived: [],
      loanRepayment: [],
      otherFinancing: [],
    };

    for (const entry of entries) {
      const amt = toNumber(entry.amount);
      const cat = (entry.category || '').toLowerCase();
      const typ = (entry.entryType || '').toLowerCase();
      const acct = entry.accountId ? accountMap.get(entry.accountId) : null;
      const code = acct?.accountCode || mapEntryToAccount(typ, cat) || '';
      const acctType = (acct?.accountType || '').toLowerCase();

      const entryRef = {
        id: entry.id,
        date: entry.createdAt,
        description: entry.description,
        amount: amt,
        category: cat,
        accountCode: code,
        accountName: acct?.accountName || code,
      };

      // ── OPERATING ACTIVITIES ──

      // Cash collected from customers (Dr Cash 1000)
      if (cat === 'cash_collection' || cat === 'cash_received') {
        buckets.cashCollectedFromCustomers += amt;
        bucketEntries.cashCollectedFromCustomers.push(entryRef);
        continue;
      }

      // Fee Revenue (Cr Fee Revenue 4000, 4100)
      if (cat === 'transaction_fee' || (typ === 'revenue' && code.startsWith('4'))) {
        buckets.feesEarned += amt;
        bucketEntries.feesEarned.push(entryRef);
        continue;
      }

      // Tax collected (Cr Tax Payable 2300)
      if (cat === 'tax' || code === '2300') {
        buckets.taxCollected += amt;
        bucketEntries.taxCollected.push(entryRef);
        continue;
      }

      // Settlement / payouts (Settlement Clearing 1100, settlement_credit)
      if (cat === 'settlement_credit' || cat === 'settlement_debit' || code === '1100') {
        buckets.payoutsToPartners += amt;
        bucketEntries.payoutsToPartners.push(entryRef);
        continue;
      }

      // Remittance Payable changes (2000)
      if (cat === 'remittance_payable' || cat === 'payout_obligation' || code === '2000') {
        buckets.changeInRemittancePayable += amt;
        bucketEntries.changeInRemittancePayable.push(entryRef);
        continue;
      }

      // Agent commissions (5200, commission)
      if (typ === 'commission' || cat === 'agent_commission' || code === '5200' || code === '2100') {
        buckets.agentCommissionsPaid += amt;
        bucketEntries.agentCommissionsPaid.push(entryRef);
        continue;
      }

      // Refunds (reversal entries, refund type)
      if (cat.startsWith('reversal_') || typ === 'refund' || code === '5400') {
        buckets.refundsIssued += amt;
        bucketEntries.refundsIssued.push(entryRef);
        continue;
      }

      // Gateway / corridor fees (5000, 5100)
      if (cat === 'gateway_fee' || cat === 'gateway_fees' || code === '5000' || code === '5100') {
        buckets.gatewayFees += amt;
        bucketEntries.gatewayFees.push(entryRef);
        continue;
      }

      // General operating expenses (5300-5800)
      if (typ === 'expense' || (acctType === 'expense' && !code.startsWith('52'))) {
        buckets.operatingExpenses += amt;
        bucketEntries.operatingExpenses.push(entryRef);
        continue;
      }

      // ── INVESTING ACTIVITIES ──
      if (code === '1600' || cat === 'fixed_asset' || cat === 'equipment') {
        buckets.equipmentPurchased += amt;
        bucketEntries.equipmentPurchased.push(entryRef);
        continue;
      }
      if (cat === 'software' || cat === 'software_investment') {
        buckets.softwareInvestment += amt;
        bucketEntries.softwareInvestment.push(entryRef);
        continue;
      }

      // ── FINANCING ACTIVITIES ──
      if (code === '3000' || cat === 'equity' || cat === 'investor_capital') {
        buckets.investorCapital += amt;
        bucketEntries.investorCapital.push(entryRef);
        continue;
      }
      if (cat === 'loan_received' || cat === 'loan_draw') {
        buckets.loanReceived += amt;
        bucketEntries.loanReceived.push(entryRef);
        continue;
      }
      if (cat === 'loan_repayment') {
        buckets.loanRepayment += amt;
        bucketEntries.loanRepayment.push(entryRef);
        continue;
      }

      // Anything else → operating expenses catch-all
      if (acctType === 'revenue') {
        buckets.feesEarned += amt;
        bucketEntries.feesEarned.push(entryRef);
      } else {
        buckets.operatingExpenses += amt;
        bucketEntries.operatingExpenses.push(entryRef);
      }
    }

    // ── Round helper ──
    const r = (v) => Math.round(v * 100) / 100;

    // ── Build Operating Activities ──
    const netOperatingCashFlow = r(
      buckets.cashCollectedFromCustomers
      + buckets.feesEarned
      + buckets.taxCollected
      - buckets.payoutsToPartners
      - buckets.agentCommissionsPaid
      - buckets.refundsIssued
      - buckets.gatewayFees
      - buckets.operatingExpenses
    );

    const operatingActivities = {
      cashCollectedFromCustomers: r(buckets.cashCollectedFromCustomers),
      feesEarned: r(buckets.feesEarned),
      taxCollected: r(buckets.taxCollected),
      payoutsToPartners: r(-buckets.payoutsToPartners),
      agentCommissionsPaid: r(-buckets.agentCommissionsPaid),
      refundsIssued: r(-buckets.refundsIssued),
      gatewayFees: r(-buckets.gatewayFees),
      operatingExpenses: r(-buckets.operatingExpenses),
      changeInRemittancePayable: r(buckets.changeInRemittancePayable),
      netOperatingCashFlow,
      // Entries for drill-down
      _entries: {
        cashCollectedFromCustomers: bucketEntries.cashCollectedFromCustomers,
        feesEarned: bucketEntries.feesEarned,
        taxCollected: bucketEntries.taxCollected,
        payoutsToPartners: bucketEntries.payoutsToPartners,
        agentCommissionsPaid: bucketEntries.agentCommissionsPaid,
        refundsIssued: bucketEntries.refundsIssued,
        gatewayFees: bucketEntries.gatewayFees,
        operatingExpenses: bucketEntries.operatingExpenses,
        changeInRemittancePayable: bucketEntries.changeInRemittancePayable,
      },
    };

    // ── Build Investing Activities ──
    const netInvestingCashFlow = r(
      -(buckets.equipmentPurchased + buckets.softwareInvestment + buckets.otherInvesting)
    );
    const investingActivities = {
      equipmentPurchased: r(-buckets.equipmentPurchased),
      softwareInvestment: r(-buckets.softwareInvestment),
      otherInvesting: r(-buckets.otherInvesting),
      netInvestingCashFlow,
      _entries: {
        equipmentPurchased: bucketEntries.equipmentPurchased,
        softwareInvestment: bucketEntries.softwareInvestment,
        otherInvesting: bucketEntries.otherInvesting,
      },
    };

    // ── Build Financing Activities ──
    const netFinancingCashFlow = r(
      buckets.investorCapital + buckets.loanReceived - buckets.loanRepayment + buckets.otherFinancing
    );
    const financingActivities = {
      investorCapital: r(buckets.investorCapital),
      loanReceived: r(buckets.loanReceived),
      loanRepayment: r(-buckets.loanRepayment),
      otherFinancing: r(buckets.otherFinancing),
      netFinancingCashFlow,
      _entries: {
        investorCapital: bucketEntries.investorCapital,
        loanReceived: bucketEntries.loanReceived,
        loanRepayment: bucketEntries.loanRepayment,
        otherFinancing: bucketEntries.otherFinancing,
      },
    };

    // ── Net Change & Balances ──
    const netCashChange = r(netOperatingCashFlow + netInvestingCashFlow + netFinancingCashFlow);

    // Opening cash balance = sum of all cash-affecting entries BEFORE the period
    let openingCashBalance = 0;
    if (startDate) {
      const priorEntries = await prisma.accountingEntry.findMany({
        where: {
          status: { not: 'reversed' },
          createdAt: { lt: new Date(startDate + 'T00:00:00.000Z') },
        },
        select: { amount: true, currency: true, category: true, entryType: true, accountId: true },
      });
      for (const pe of priorEntries) {
        if (normCurrency(pe.currency) !== currency) continue;
        const pCat = (pe.category || '').toLowerCase();
        const pTyp = (pe.entryType || '').toLowerCase();
        const pAcct = pe.accountId ? accountMap.get(pe.accountId) : null;
        const pCode = pAcct?.accountCode || mapEntryToAccount(pTyp, pCat) || '';
        const pAcctType = (pAcct?.accountType || '').toLowerCase();
        // Only count asset-cash accounts (1000, 1100, 1200, 1300, 1400)
        if (pAcctType === 'asset' || pCode.startsWith('1')) {
          if (pCat === 'cash_collection' || pCat === 'cash_received') {
            openingCashBalance += toNumber(pe.amount);
          } else if (pCat === 'settlement_credit') {
            openingCashBalance -= toNumber(pe.amount);
          } else if (pCat.startsWith('reversal_cash')) {
            openingCashBalance -= toNumber(pe.amount);
          }
        }
      }
    }
    openingCashBalance = r(openingCashBalance);
    const closingCashBalance = r(openingCashBalance + netCashChange);

    // ── Previous period comparison (optional) ──
    let previousPeriod = null;
    if (compare && startDate && endDate) {
      const start = new Date(startDate + 'T00:00:00.000Z');
      const end = new Date(endDate + 'T23:59:59.999Z');
      const durationMs = end.getTime() - start.getTime();
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - durationMs);

      const prevEntries = await prisma.accountingEntry.findMany({
        where: {
          status: { not: 'reversed' },
          createdAt: { gte: prevStart, lte: prevEnd },
        },
        select: { amount: true, currency: true, category: true, entryType: true, accountId: true },
      });

      let prevCashIn = 0, prevFees = 0, prevPayouts = 0, prevExpenses = 0;
      for (const pe of prevEntries) {
        if (normCurrency(pe.currency) !== currency) continue;
        const pCat = (pe.category || '').toLowerCase();
        if (pCat === 'cash_collection' || pCat === 'cash_received') prevCashIn += toNumber(pe.amount);
        else if (pCat === 'transaction_fee') prevFees += toNumber(pe.amount);
        else if (pCat === 'settlement_credit' || pCat === 'settlement_debit') prevPayouts += toNumber(pe.amount);
        else prevExpenses += toNumber(pe.amount);
      }
      previousPeriod = {
        cashCollected: r(prevCashIn),
        feesEarned: r(prevFees),
        payouts: r(prevPayouts),
        expenses: r(prevExpenses),
        netCash: r(prevCashIn + prevFees - prevPayouts - prevExpenses),
      };
    }

    return res.json({
      success: true,
      data: {
        period: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
        currency,
        operatingActivities,
        investingActivities,
        financingActivities,
        netCashChange,
        openingCashBalance,
        closingCashBalance,
        previousPeriod,
        entryCount: entries.length,
      },
    });
  } catch (error) {
    console.error('[API] getCashFlowStatement error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get cash flow statement' });
  }
};

/** Return an empty cash flow structure (for when tables don't exist yet). */
function buildEmptyCashFlow(currency) {
  const zero = {
    cashCollectedFromCustomers: 0, feesEarned: 0, taxCollected: 0,
    payoutsToPartners: 0, agentCommissionsPaid: 0, refundsIssued: 0,
    gatewayFees: 0, operatingExpenses: 0, changeInRemittancePayable: 0,
    netOperatingCashFlow: 0, _entries: {},
  };
  return {
    period: { startDate: null, endDate: null },
    currency,
    operatingActivities: zero,
    investingActivities: { equipmentPurchased: 0, softwareInvestment: 0, otherInvesting: 0, netInvestingCashFlow: 0, _entries: {} },
    financingActivities: { investorCapital: 0, loanReceived: 0, loanRepayment: 0, otherFinancing: 0, netFinancingCashFlow: 0, _entries: {} },
    netCashChange: 0,
    openingCashBalance: 0,
    closingCashBalance: 0,
    previousPeriod: null,
    entryCount: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE SHEET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/accounting/balance-sheet
 *
 * Returns a Balance Sheet snapshot at a given date:
 *   Assets = Liabilities + Equity
 *
 * The report sums ALL accounting entries up to (and including) the "asOf" date,
 * grouped by account. Revenue and Expense entries are rolled into
 * "Current Year Earnings" under Equity.
 *
 * Query params:
 *   asOf       = YYYY-MM-DD  (default: today)
 *   currency   = USD (default)
 *   comparePreviousPeriod = true/false  (optional — adds prior period snapshot)
 */
export const getBalanceSheet = async (req, res) => {
  try {
    if (!hasAccountingModel() || !hasAccountingAccountModel()) {
      return res.json({ success: true, data: buildEmptyBalanceSheet(normCurrency(req.query.currency || 'USD')) });
    }

    const {
      asOf: asOfParam,
      currency: queryCurrency = 'USD',
      comparePreviousPeriod,
    } = req.query;

    const currency = normCurrency(queryCurrency);
    const asOf = asOfParam ? new Date(asOfParam + 'T23:59:59.999Z') : new Date();
    const compare = comparePreviousPeriod === 'true';

    // Fetch ALL non-reversed entries up to asOf date
    const allEntries = await prisma.accountingEntry.findMany({
      where: {
        status: { not: 'reversed' },
        createdAt: { lte: asOf },
      },
      select: {
        id: true,
        entryType: true,
        category: true,
        amount: true,
        currency: true,
        accountId: true,
        createdAt: true,
      },
    });

    // Filter by currency
    const entries = allEntries.filter((e) => normCurrency(e.currency) === currency);

    // Fetch all accounts from Chart of Accounts
    const accounts = await prisma.accountingAccount.findMany({
      select: { id: true, accountCode: true, accountType: true, accountName: true },
      orderBy: { accountCode: 'asc' },
    });
    const accountMap = new Map();
    for (const a of accounts) {
      accountMap.set(a.id, a);
    }

    // ── Aggregate balances per account ──
    const accountBalances = new Map(); // accountCode → { name, type, debit, credit }

    for (const entry of entries) {
      const amt = toNumber(entry.amount);
      const cat = (entry.category || '').toLowerCase();
      const typ = (entry.entryType || '').toLowerCase();
      const acct = entry.accountId ? accountMap.get(entry.accountId) : null;
      const code = acct?.accountCode || mapEntryToAccount(typ, cat);
      if (!code) continue;

      if (!accountBalances.has(code)) {
        const acctInfo = acct || accounts.find((a) => a.accountCode === code);
        accountBalances.set(code, {
          accountCode: code,
          accountName: acctInfo?.accountName || code,
          accountType: (acctInfo?.accountType || 'asset').toLowerCase(),
          debit: 0,
          credit: 0,
        });
      }

      const bal = accountBalances.get(code);
      const acctType = bal.accountType;
      const isDebit = determineDebitCredit(acctType, typ, amt > 0, cat);

      if (isDebit) {
        bal.debit += Math.abs(amt);
      } else {
        bal.credit += Math.abs(amt);
      }
    }

    // ── Classify into sections ──
    const assets = [];
    const liabilities = [];
    const equity = [];
    let totalRevenue = 0;
    let totalExpenses = 0;

    for (const [, bal] of accountBalances) {
      const r = (v) => Math.round(v * 100) / 100;
      let balance;

      switch (bal.accountType) {
        case 'asset':
          // Assets: normal balance = debit; balance = debit - credit
          balance = r(bal.debit - bal.credit);
          if (balance !== 0) {
            assets.push({ ...bal, balance, debit: r(bal.debit), credit: r(bal.credit) });
          }
          break;

        case 'liability':
          // Liabilities: normal balance = credit; balance = credit - debit
          balance = r(bal.credit - bal.debit);
          if (balance !== 0) {
            liabilities.push({ ...bal, balance, debit: r(bal.debit), credit: r(bal.credit) });
          }
          break;

        case 'equity':
          balance = r(bal.credit - bal.debit);
          if (balance !== 0) {
            equity.push({ ...bal, balance, debit: r(bal.debit), credit: r(bal.credit) });
          }
          break;

        case 'revenue':
          // Revenue is credit-normal; net = credit - debit
          totalRevenue += r(bal.credit - bal.debit);
          break;

        case 'expense':
          // Expense is debit-normal; net = debit - credit
          totalExpenses += r(bal.debit - bal.credit);
          break;
      }
    }

    // ── Current Year Earnings = Revenue − Expenses ──
    const currentYearEarnings = Math.round((totalRevenue - totalExpenses) * 100) / 100;

    // Add Current Year Earnings to equity section
    equity.push({
      accountCode: 'CYE',
      accountName: 'Current Year Earnings',
      accountType: 'equity',
      balance: currentYearEarnings,
      debit: Math.round(totalExpenses * 100) / 100,
      credit: Math.round(totalRevenue * 100) / 100,
      isCalculated: true,
    });

    // ── Totals ──
    const totalAssets = Math.round(assets.reduce((s, a) => s + a.balance, 0) * 100) / 100;
    const totalLiabilities = Math.round(liabilities.reduce((s, a) => s + a.balance, 0) * 100) / 100;
    const totalEquity = Math.round(equity.reduce((s, a) => s + a.balance, 0) * 100) / 100;
    const liabilitiesPlusEquity = Math.round((totalLiabilities + totalEquity) * 100) / 100;
    const isBalanced = Math.abs(totalAssets - liabilitiesPlusEquity) < 0.01;

    // Sort within each section by account code
    assets.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    liabilities.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    equity.sort((a, b) => {
      if (a.accountCode === 'CYE') return 1; // Current Year Earnings last
      if (b.accountCode === 'CYE') return -1;
      return a.accountCode.localeCompare(b.accountCode);
    });

    // ── Previous period comparison (optional) ──
    let previousPeriod = null;
    if (compare && asOfParam) {
      // Go back same number of days
      const now = new Date(asOfParam + 'T23:59:59.999Z');
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const daysSinceYearStart = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
      const prevDate = new Date(startOfYear.getTime() - 1); // End of previous year

      const prevEntries = allEntries.filter((e) => new Date(e.createdAt) <= prevDate && normCurrency(e.currency) === currency);
      let prevAssets = 0, prevLiabilities = 0, prevRevenue = 0, prevExpenses = 0;

      for (const entry of prevEntries) {
        const amt = toNumber(entry.amount);
        const cat = (entry.category || '').toLowerCase();
        const typ = (entry.entryType || '').toLowerCase();
        const acct = entry.accountId ? accountMap.get(entry.accountId) : null;
        const code = acct?.accountCode || mapEntryToAccount(typ, cat);
        if (!code) continue;
        const acctInfo = acct || accounts.find((a) => a.accountCode === code);
        const acctType = (acctInfo?.accountType || 'asset').toLowerCase();
        const isDebit = determineDebitCredit(acctType, typ, amt > 0, cat);
        const absAmt = Math.abs(amt);

        if (acctType === 'asset') prevAssets += isDebit ? absAmt : -absAmt;
        else if (acctType === 'liability') prevLiabilities += isDebit ? -absAmt : absAmt;
        else if (acctType === 'revenue') prevRevenue += isDebit ? -absAmt : absAmt;
        else if (acctType === 'expense') prevExpenses += isDebit ? absAmt : -absAmt;
      }

      const prevCYE = prevRevenue - prevExpenses;
      previousPeriod = {
        asOf: prevDate.toISOString().slice(0, 10),
        totalAssets: Math.round(prevAssets * 100) / 100,
        totalLiabilities: Math.round(prevLiabilities * 100) / 100,
        totalEquity: Math.round(prevCYE * 100) / 100,
      };
    }

    return res.json({
      success: true,
      data: {
        asOf: asOf.toISOString(),
        currency,
        assets,
        liabilities,
        equity,
        totalAssets,
        totalLiabilities,
        totalEquity,
        liabilitiesPlusEquity,
        isBalanced,
        currentYearEarnings,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        previousPeriod,
        entryCount: entries.length,
      },
    });
  } catch (error) {
    console.error('[API] getBalanceSheet error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to get balance sheet' });
  }
};

/** Return an empty balance sheet. */
function buildEmptyBalanceSheet(currency) {
  return {
    asOf: new Date().toISOString(),
    currency,
    assets: [],
    liabilities: [],
    equity: [],
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    liabilitiesPlusEquity: 0,
    isBalanced: true,
    currentYearEarnings: 0,
    totalRevenue: 0,
    totalExpenses: 0,
    previousPeriod: null,
    entryCount: 0,
  };
}

/**
 * Map entry to default account code based on entry type and category
 * @param {string} entryType - Entry type (revenue, expense, fee, commission, refund)
 * @param {string} category - Entry category
 * @returns {string|null} - Account code or null
 */
function mapEntryToAccount(entryType, category) {
  const c = (category || '').toLowerCase();
  const t = (entryType || '').toLowerCase();

  // ── Category-based mapping (highest priority) ──
  // Collection / Cash
  if (c === 'cash_collection' || c === 'cash_received') return '1000';
  if (c === 'customer_wallet') return '1200';
  // Settlement
  if (c === 'settlement_credit') return '1100'; // Settlement Clearing (Asset)
  if (c === 'settlement_debit') return '2000';  // Remittance Payable (Liability) – clearing
  // Remittance liability
  if (c === 'remittance_payable' || c === 'payout_obligation') return '2000';
  // Reversals
  if (c === 'reversal_cash') return '1000';
  if (c === 'reversal_payable') return '2000';
  if (c === 'reversal_fee') return '4000';
  // Tax
  if (c === 'tax') return '2300'; // Tax Payable

  // ── Revenue entries ──
  if (t === 'revenue' || t === 'fee' || t === 'commission') {
    if (c === 'transaction_fee' || c === 'transaction') return '4000'; // Fee Revenue
    if (t === 'commission') return '4200';
    return '4000';
  }

  // ── Expense entries ──
  if (t === 'expense') {
    if (c === 'gateway_fee' || c === 'gateway_fees') return '5000';
    if (c === 'operational_cost' || c === 'operational') return '5300';
    return '5000';
  }

  // ── Refunds ──
  if (t === 'refund') return '5400';

  return null;
}
