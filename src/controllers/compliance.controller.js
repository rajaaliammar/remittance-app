/**
 * Compliance Controller
 *
 * Provides admin endpoints for reviewing compliance alerts and managing
 * held transactions. All routes require backoffice authentication.
 */

import prisma from '../utils/prisma.js';
import { WalletError, creditCustomerWallet } from '../utils/walletLock.js';

const txInclude = {
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      createdAt: true,
      lastTransactionAt: true,
      level: true,
    },
  },
  complianceAlerts: true,
};

// ─── Alerts ─────────────────────────────────────────────────────────────────

/** GET /api/compliance/alerts  – list all compliance alerts with pagination */
export const listComplianceAlerts = async (req, res) => {
  try {
    const { limit = 50, offset = 0, status, ruleCode, customerId } = req.query;
    const take = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = Math.max(parseInt(offset, 10) || 0, 0);

    const where = {};
    if (status) where.status = String(status).toUpperCase();
    if (ruleCode) where.ruleCode = String(ruleCode).toUpperCase();
    if (customerId) where.customerId = String(customerId);

    const [alerts, total] = await Promise.all([
      prisma.complianceAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          transaction: {
            select: {
              id: true,
              sendAmount: true,
              receiveAmount: true,
              currency: true,
              status: true,
              riskScore: true,
              triggeredRules: true,
              createdAt: true,
              customer: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
      prisma.complianceAlert.count({ where }),
    ]);

    res.json({ success: true, data: alerts, total });
  } catch (error) {
    console.error('Error listing compliance alerts:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET /api/compliance/alerts/:id  – single alert detail */
export const getComplianceAlertById = async (req, res) => {
  try {
    const { id } = req.params;
    const alert = await prisma.complianceAlert.findUnique({
      where: { id },
      include: {
        transaction: { include: txInclude },
      },
    });
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
    res.json({ success: true, data: alert });
  } catch (error) {
    console.error('Error fetching compliance alert:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Held Transactions ───────────────────────────────────────────────────────

/** GET /api/compliance/held-transactions  – list all transactions in Hold status */
export const listHeldTransactions = async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const take = Math.min(parseInt(limit, 10) || 50, 200);
    const skip = Math.max(parseInt(offset, 10) || 0, 0);

    const where = { status: 'Hold' };

    const [transactions, total] = await Promise.all([
      prisma.remittanceTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: txInclude,
      }),
      prisma.remittanceTransaction.count({ where }),
    ]);

    res.json({ success: true, data: transactions, total });
  } catch (error) {
    console.error('Error listing held transactions:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/compliance/held-transactions/:id/approve
 * Approves a held transaction → moves it to Processing.
 * Closes all open compliance alerts for this transaction.
 */
export const approveHeldTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body || {};
    const adminId = req.user?.id;

    const transaction = await prisma.remittanceTransaction.findUnique({ where: { id } });
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if ((transaction.status || '').toLowerCase() !== 'hold') {
      return res.status(400).json({
        success: false,
        message: `Only held transactions can be approved. Current status: ${transaction.status}`,
      });
    }

    const [updated] = await Promise.all([
      prisma.remittanceTransaction.update({
        where: { id },
        data: {
          status: 'Processing',
          complianceReviewNote: note || null,
          updatedAt: new Date(),
        },
        include: txInclude,
      }),
      prisma.complianceAlert.updateMany({
        where: { transactionId: id, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          resolvedBy: adminId || null,
          resolvedAt: new Date(),
          resolvedNote: note || 'Approved by compliance officer',
          updatedAt: new Date(),
        },
      }),
    ]);

    const io = req.app?.get?.('io');
    if (io) {
      io.to(`user:${transaction.customerId}`).emit('transaction-status', {
        transactionId: id,
        status: 'Processing',
        message: 'Your transaction has been approved and is now being processed.',
      });
    }

    res.json({
      success: true,
      message: 'Transaction approved and moved to Processing.',
      data: updated,
    });
  } catch (error) {
    console.error('Error approving held transaction:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/compliance/held-transactions/:id/reject
 * Rejects a held transaction → sets status to Failed and refunds customer.
 * Closes all open compliance alerts.
 */
export const rejectHeldTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body || {};
    const adminId = req.user?.id;

    const transaction = await prisma.remittanceTransaction.findUnique({
      where: { id },
      include: { customer: { select: { id: true, availableBalance: true } } },
    });
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    if ((transaction.status || '').toLowerCase() !== 'hold') {
      return res.status(400).json({
        success: false,
        message: `Only held transactions can be rejected here. Current status: ${transaction.status}`,
      });
    }

    const customerId = transaction.customerId;
    const sendAmount = Number(transaction.sendAmount ?? 0);
    const recipientInfo =
      transaction.recipientInfo && typeof transaction.recipientInfo === 'object'
        ? transaction.recipientInfo
        : {};
    const paymentFieldValues =
      transaction.paymentFieldValues && typeof transaction.paymentFieldValues === 'object'
        ? transaction.paymentFieldValues
        : {};
    const fee = Number(
      recipientInfo.fee ?? paymentFieldValues.charge ?? paymentFieldValues.fee ?? 0,
    );
    const totalToRefund = sendAmount + fee;

    let newBalance;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const creditResult = await creditCustomerWallet(tx, customerId, totalToRefund);
        await tx.remittanceTransaction.update({
          where: { id },
          data: {
            status: 'Failed',
            complianceReviewNote: note || null,
            updatedAt: new Date(),
          },
        });
        return { newBalance: creditResult.newBalance };
      });
      newBalance = result.newBalance;
    } catch (walletErr) {
      if (walletErr instanceof WalletError) {
        return res.status(walletErr.statusCode).json({
          success: false,
          message: walletErr.message,
          code: walletErr.code,
        });
      }
      throw walletErr;
    }

    await prisma.complianceAlert.updateMany({
      where: { transactionId: id, status: 'OPEN' },
      data: {
        status: 'CLOSED',
        resolvedBy: adminId || null,
        resolvedAt: new Date(),
        resolvedNote: note || 'Rejected by compliance officer',
        updatedAt: new Date(),
      },
    });

    const io = req.app?.get?.('io');
    if (io) {
      io.to(`user:${customerId}`).emit('transaction-status', {
        transactionId: id,
        status: 'Failed',
        message: 'Your transaction could not be processed. Your funds have been refunded.',
      });
    }

    res.json({
      success: true,
      message: 'Transaction rejected. Customer balance refunded.',
      data: { transactionId: id, refundedAmount: totalToRefund, newBalance },
    });
  } catch (error) {
    console.error('Error rejecting held transaction:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Risk Score / Customer Profile ──────────────────────────────────────────

/** GET /api/compliance/risk-score/:customerId */
export const getCustomerRiskProfile = async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
        lastTransactionAt: true,
        level: true,
        kycData: true,
      },
    });
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const [openAlerts, recentTransactions, totalHeld] = await Promise.all([
      prisma.complianceAlert.count({
        where: { customerId, status: 'OPEN' },
      }),
      prisma.remittanceTransaction.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          sendAmount: true,
          status: true,
          riskScore: true,
          triggeredRules: true,
          createdAt: true,
        },
      }),
      prisma.remittanceTransaction.count({
        where: { customerId, status: 'Hold' },
      }),
    ]);

    const avgRiskScore =
      recentTransactions.length > 0
        ? Math.round(
            recentTransactions.reduce((s, t) => s + (t.riskScore ?? 0), 0) /
              recentTransactions.length,
          )
        : 0;

    res.json({
      success: true,
      data: {
        customer,
        riskProfile: {
          avgRiskScore,
          openAlerts,
          totalHeldTransactions: totalHeld,
          recentTransactions,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching customer risk profile:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/** GET /api/compliance/stats  – summary stats for dashboard */
export const getComplianceStats = async (req, res) => {
  try {
    const [openAlerts, heldTx, closedToday, totalAlerts] = await Promise.all([
      prisma.complianceAlert.count({ where: { status: 'OPEN' } }),
      prisma.remittanceTransaction.count({ where: { status: 'Hold' } }),
      prisma.complianceAlert.count({
        where: {
          status: 'CLOSED',
          resolvedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      prisma.complianceAlert.count(),
    ]);

    // Rule breakdown – count of OPEN alerts per rule code
    const ruleBreakdown = await prisma.complianceAlert.groupBy({
      by: ['ruleCode'],
      where: { status: 'OPEN' },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    res.json({
      success: true,
      data: {
        openAlerts,
        heldTransactions: heldTx,
        closedAlertsToday: closedToday,
        totalAlerts,
        ruleBreakdown: ruleBreakdown.map((r) => ({
          rule: r.ruleCode,
          count: r._count.id,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching compliance stats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
