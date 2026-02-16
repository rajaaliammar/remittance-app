import prisma from '../utils/prisma.js';
import { calculateTransactionFee } from '../utils/chargeUtils.js';

/** Start of today UTC */
function startOfDayUTC(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}
/** Start of week (Monday) UTC */
function startOfWeekUTC(d) {
  const x = new Date(d);
  const day = x.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(x);
  monday.setUTCDate(x.getUTCDate() + mondayOffset);
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
}
/** Start of month UTC */
function startOfMonthUTC(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1));
}

/**
 * Get customer's transaction limits from their level (daily, weekly, monthly).
 * If customer has no level, use the first level (lowest priority) so "assign to all users" applies.
 * Returns null if no limits configured (no limit enforced).
 */
async function getCustomerLimits(customerId) {
  let level = null;
  const customerRow = await prisma.$queryRaw`
    SELECT id, "level" FROM customers WHERE id = ${customerId}
  `.then((rows) => rows?.[0]);
  if (customerRow?.level) {
    level = await prisma.level.findUnique({
      where: { id: customerRow.level },
      select: { transactionLimits: true },
    });
  }
  if (!level?.transactionLimits) {
    const firstLevel = await prisma.level.findFirst({
      orderBy: { priority: 'asc' },
      select: { transactionLimits: true },
    });
    level = firstLevel;
  }
  if (!level?.transactionLimits || !Array.isArray(level.transactionLimits) || level.transactionLimits.length === 0) {
    return null;
  }
  const first = level.transactionLimits[0];
  const daily = first.dailyAmount != null ? Number(first.dailyAmount) : null;
  const weekly = first.weeklyAmount != null ? Number(first.weeklyAmount) : null;
  const monthly = first.monthlyAmount != null ? Number(first.monthlyAmount) : null;
  const currency = first.currency || 'USD';
  if (daily == null && weekly == null && monthly == null) return null;
  return { daily, weekly, monthly, currency };
}

/**
 * Get total sent amount by customer in period [from, to] (UTC).
 */
async function getSentInPeriod(customerId, from, to) {
  const result = await prisma.remittanceTransaction.aggregate({
    where: {
      customerId,
      type: 'Sent',
      createdAt: { gte: from, lte: to },
    },
    _sum: { sendAmount: true },
  });
  return Number(result._sum?.sendAmount ?? 0);
}

/**
 * Create a remittance transaction (after user confirms payment in app)
 */
export const createRemittanceTransaction = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Block transaction if customer has any KYC document pending
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { kycData: true },
    });
    if (customer?.kycData) {
      let raw = customer.kycData;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = null;
        }
      }
      const docs = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const hasPending = docs.some((doc) => (doc.status || '').toLowerCase() === 'pending');
      if (hasPending) {
        return res.status(403).json({
          success: false,
          message: 'You cannot make a transaction while your KYC is pending. Please wait for your verification to be approved.',
        });
      }
    }

    const {
      sendAmount,
      receiveAmount,
      currency,
      gatewayId,
      gatewayName,
      recipientInfo,
      paymentFieldValues,
      transferType,
      countryId,
    } = req.body || {};

    const send = parseFloat(sendAmount);
    const receive = parseFloat(receiveAmount);
    if (isNaN(send) || send < 0 || isNaN(receive) || receive < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid sendAmount and receiveAmount are required',
      });
    }

    // Calculate fees on backend for security and accuracy (transferType filters tax/fee by applyTo: bank | wallet | both)
    const { totalCharge, breakdown } = await calculateTransactionFee({
      amount: send,
      countryId,
      transferType: transferType === 'wallet' ? 'wallet' : 'bank'
    });

    const totalToDeduct = send + totalCharge;

    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.create !== 'function') {
      console.error('Prisma remittanceTransaction delegate missing. Run: npx prisma generate');
      return res.status(503).json({
        success: false,
        message: 'RemittanceTransaction model not available. Run: npx prisma generate and restart the server.',
      });
    }

    const rows = await prisma.$queryRaw`
      SELECT "availableBalance" FROM customers WHERE id = ${customerId}
    `;
    const row = rows?.[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    const currentBalance = row.availableBalance != null
      ? Number(row.availableBalance)
      : 12000;

    if (currentBalance < totalToDeduct) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ${currentBalance.toFixed(2)}, required (including fees): ${totalToDeduct.toFixed(2)}`,
      });
    }

    // Check daily / weekly / monthly limits from user level
    const limits = await getCustomerLimits(customerId);
    if (limits) {
      const now = new Date();
      const startDay = startOfDayUTC(now);
      const startWeek = startOfWeekUTC(now);
      const startMonth = startOfMonthUTC(now);
      const [usedDaily, usedWeekly, usedMonthly] = await Promise.all([
        limits.daily != null ? getSentInPeriod(customerId, startDay, now) : 0,
        limits.weekly != null ? getSentInPeriod(customerId, startWeek, now) : 0,
        limits.monthly != null ? getSentInPeriod(customerId, startMonth, now) : 0,
      ]);
      if (limits.daily != null && usedDaily + send > limits.daily) {
        return res.status(400).json({
          success: false,
          message: `You have exceeded your daily transfer limit. Your daily limit is ${limits.daily.toFixed(2)} ${limits.currency}. You cannot transfer more than this amount.`,
          code: 'DAILY_LIMIT_EXCEEDED',
        });
      }
      if (limits.weekly != null && usedWeekly + send > limits.weekly) {
        return res.status(400).json({
          success: false,
          message: `You have exceeded your weekly transfer limit. Your weekly limit is ${limits.weekly.toFixed(2)} ${limits.currency}. You cannot transfer more than this amount.`,
          code: 'WEEKLY_LIMIT_EXCEEDED',
        });
      }
      if (limits.monthly != null && usedMonthly + send > limits.monthly) {
        return res.status(400).json({
          success: false,
          message: `You have exceeded your monthly transfer limit. Your monthly limit is ${limits.monthly.toFixed(2)} ${limits.currency}. You cannot transfer more than this amount.`,
          code: 'MONTHLY_LIMIT_EXCEEDED',
        });
      }
    }

    const newBalance = currentBalance - totalToDeduct;

    const txType = (transferType === 'wallet' ? 'wallet' : 'bank');

    // Enrich recipientInfo with fee details for history/receipts
    const enrichedRecipientInfo = {
      ...(recipientInfo || {}),
      fee: totalCharge,
      feeBreakdown: breakdown,
      baseAmount: send,
      totalAmount: totalToDeduct,
      countryId
    };

    const [transaction] = await prisma.$transaction([
      delegate.create({
        data: {
          customerId,
          type: 'Sent',
          transferType: txType,
          sendAmount: send,
          receiveAmount: receive,
          currency: currency || null,
          gatewayId: gatewayId || null,
          gatewayName: gatewayName || null,
          recipientInfo: enrichedRecipientInfo,
          paymentFieldValues: paymentFieldValues || null,
          status: 'Processing',
        },
      }),
      prisma.$executeRaw`
        UPDATE customers SET "availableBalance" = ${newBalance} WHERE id = ${customerId}
      `,
    ]);

    res.status(201).json({
      success: true,
      data: {
        ...transaction,
        newBalance,
      },
    });
  } catch (error) {
    console.error('Error creating remittance transaction:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create transaction',
    });
  }
};

/**
 * List remittance transactions for the authenticated customer
 */
export const listRemittanceTransactions = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.findMany !== 'function') {
      console.error('Prisma remittanceTransaction delegate missing. Run: npx prisma generate');
      return res.status(503).json({
        success: false,
        message: 'RemittanceTransaction model not available. Run: npx prisma generate and restart the server.',
      });
    }

    const { limit = 50, offset = 0 } = req.query;
    const take = Math.min(parseInt(limit, 10) || 50, 100);
    const skip = Math.max(parseInt(offset, 10) || 0, 0);

    const [transactions, total] = await Promise.all([
      delegate.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      delegate.count({ where: { customerId } }),
    ]);

    res.json({
      success: true,
      data: transactions,
      total,
    });
  } catch (error) {
    console.error('Error listing remittance transactions:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list transactions',
    });
  }
};

/**
 * List all remittance transactions (admin/portal) - for Transaction Log in dashboard
 */
export const listAllRemittanceTransactions = async (req, res) => {
  try {
    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.findMany !== 'function') {
      return res.status(503).json({
        success: false,
        message: 'RemittanceTransaction model not available.',
      });
    }

    const { limit = 100, offset = 0 } = req.query;
    const take = Math.min(parseInt(limit, 10) || 100, 500);
    const skip = Math.max(parseInt(offset, 10) || 0, 0);

    const [transactions, total] = await Promise.all([
      delegate.findMany({
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
      delegate.count(),
    ]);

    res.json({
      success: true,
      data: transactions,
      total,
    });
  } catch (error) {
    console.error('Error listing all remittance transactions:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list transactions',
    });
  }
};
