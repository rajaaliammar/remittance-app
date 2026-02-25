import prisma from '../utils/prisma.js';
import { reconcileAccountingEntries, syncAccountingEntriesFromTransactions } from '../utils/accounting.js';

const ENTRY_TYPES = ['revenue', 'expense', 'fee', 'commission', 'refund'];
const PERIOD_TYPES = ['daily', 'weekly', 'monthly', 'yearly'];

/** True if accounting tables are available (migration run + prisma generate). */
function hasAccountingModel() {
  return prisma.accountingEntry && typeof prisma.accountingEntry.findMany === 'function';
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
      if (groupBy && groupBy !== 'none' && PERIOD_TYPES.includes(groupBy) && !isPrincipalOnly) {
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
            select: { id: true, sendAmount: true, receiveAmount: true, status: true, transferType: true, gatewayName: true },
          },
        },
      }),
      prisma.accountingEntry.count({ where }),
    ]);

    const data = entries.map((e) => ({
      ...e,
      amount: toNumber(e.amount),
    }));
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
