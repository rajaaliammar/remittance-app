/**
 * AML / Compliance Rule Engine
 *
 * Implements Threshold (T1-T7), Behavioral (B1-B10), and risk-score (RS70) rules
 * from the compliance specification.
 *
 * Pass `excludeTransactionId` when rules run after the row is created so rolling
 * sums do not double-count the in-flight transfer.
 */

import prisma from '../utils/prisma.js';

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000);
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

const ACTIVE_STATUSES = ['Processing', 'Completed', 'Hold', 'Manual_Review'];

/** Stable key for beneficiary aggregation (matches stored recipientInfo JSON). */
export function extractBeneficiaryKey(ri) {
  if (!ri || typeof ri !== 'object') return null;
  if (ri.beneficiaryId) return `cid:${String(ri.beneficiaryId)}`;
  if (ri.beneficiaryKey) return String(ri.beneficiaryKey);
  const acc = String(ri.accountNumber || '').trim();
  const name = String(ri.accountHolderName || ri.name || '').trim().toLowerCase();
  if (!acc && !name) return null;
  return `ext:${acc}:${name}`;
}

function recipientWhereClause(beneficiaryCustomerId, beneficiaryKeyPlain) {
  const or = [];
  if (beneficiaryCustomerId) {
    or.push({ recipientInfo: { path: ['beneficiaryId'], equals: beneficiaryCustomerId } });
  }
  if (beneficiaryKeyPlain) {
    or.push({ recipientInfo: { path: ['beneficiaryKey'], equals: beneficiaryKeyPlain } });
  }
  if (or.length === 0) return null;
  if (or.length === 1) return or[0];
  return { OR: or };
}

function excludeClause(excludeTransactionId) {
  return excludeTransactionId ? { id: { not: excludeTransactionId } } : {};
}

async function senderSumInWindow(senderId, since, excludeTransactionId) {
  const agg = await prisma.remittanceTransaction.aggregate({
    where: {
      customerId: senderId,
      createdAt: { gte: since },
      status: { in: ACTIVE_STATUSES },
      ...excludeClause(excludeTransactionId),
    },
    _sum: { sendAmount: true },
    _count: { id: true },
  });
  return {
    total: Number(agg._sum.sendAmount ?? 0),
    count: agg._count.id ?? 0,
  };
}

async function beneficiarySumInWindow(
  beneficiaryCustomerId,
  beneficiaryKeyPlain,
  since,
  excludeTransactionId,
) {
  const clause = recipientWhereClause(beneficiaryCustomerId, beneficiaryKeyPlain);
  if (!clause) {
    return { total: 0, count: 0 };
  }
  const agg = await prisma.remittanceTransaction.aggregate({
    where: {
      ...clause,
      createdAt: { gte: since },
      status: { in: ACTIVE_STATUSES },
      ...excludeClause(excludeTransactionId),
    },
    _sum: { sendAmount: true },
    _count: { id: true },
  });
  return {
    total: Number(agg._sum.sendAmount ?? 0),
    count: agg._count.id ?? 0,
  };
}

async function distinctSendersToBeneficiary(
  beneficiaryCustomerId,
  beneficiaryKeyPlain,
  since,
  excludeTransactionId,
  currentSenderId,
  currentSendAmount,
) {
  const clause = recipientWhereClause(beneficiaryCustomerId, beneficiaryKeyPlain);
  if (!clause) {
    return { uniqueSenders: 0, projectedSendTotal: 0 };
  }
  const txns = await prisma.remittanceTransaction.findMany({
    where: {
      ...clause,
      createdAt: { gte: since },
      status: { in: ACTIVE_STATUSES },
      ...excludeClause(excludeTransactionId),
    },
    select: { customerId: true, sendAmount: true },
  });
  const senders = new Set(txns.map((t) => t.customerId));
  senders.add(currentSenderId);
  const pastSendTotal = txns.reduce((s, t) => s + Number(t.sendAmount ?? 0), 0);
  const projectedSendTotal = pastSendTotal + Number(currentSendAmount ?? 0);
  return { uniqueSenders: senders.size, projectedSendTotal };
}

async function distinctBeneficiariesFromSender(
  senderId,
  since,
  excludeTransactionId,
  currentBeneficiaryKey,
) {
  const txns = await prisma.remittanceTransaction.findMany({
    where: {
      customerId: senderId,
      createdAt: { gte: since },
      status: { in: ACTIVE_STATUSES },
      ...excludeClause(excludeTransactionId),
    },
    select: { recipientInfo: true, sendAmount: true },
  });
  const keys = new Set();
  for (const t of txns) {
    const k = extractBeneficiaryKey(t.recipientInfo);
    if (k) keys.add(k);
  }
  if (currentBeneficiaryKey) keys.add(currentBeneficiaryKey);
  const totalAmount = txns.reduce((s, t) => s + Number(t.sendAmount ?? 0), 0);
  return { uniqueBeneficiaries: keys.size, totalAmount };
}

const RISK_WEIGHTS = {
  newAccount: 20,
  largeTransfer: 30,
  veryLargeTransfer: 50,
  multipleBeneficiaries: 40,
  multipleIncomingSenders: 40,
  inactiveAccount: 30,
  singleLargeTransfer3k: 10,
};

function computeRiskScore(amount, flags = {}) {
  let score = 0;
  if (flags.isNewAccount) score += RISK_WEIGHTS.newAccount;
  if (amount >= 10000) score += RISK_WEIGHTS.veryLargeTransfer;
  else if (amount >= 5000) score += RISK_WEIGHTS.largeTransfer;
  else if (amount >= 3000) score += RISK_WEIGHTS.singleLargeTransfer3k;
  if (flags.multipleBeneficiaries) score += RISK_WEIGHTS.multipleBeneficiaries;
  if (flags.multipleIncomingSenders) score += RISK_WEIGHTS.multipleIncomingSenders;
  if (flags.isInactiveAccount) score += RISK_WEIGHTS.inactiveAccount;
  return score;
}

/**
 * @param {Object} ctx
 * @param {string} ctx.senderId
 * @param {string} [ctx.beneficiaryCustomerId] - customerId of beneficiary when internal user
 * @param {string} [ctx.beneficiaryKeyPlain] - stored `ext:...` key (not cid wrapper)
 * @param {string} ctx.currentBeneficiaryKey - extractBeneficiaryKey(...) for this transfer
 * @param {number} ctx.amount
 * @param {string} [ctx.excludeTransactionId]
 */
export async function runComplianceRules(ctx) {
  const {
    senderId,
    beneficiaryCustomerId = null,
    beneficiaryKeyPlain = null,
    currentBeneficiaryKey = null,
    amount,
    excludeTransactionId = null,
  } = ctx;

  const triggered = [];

  const sender = await prisma.customer.findUnique({
    where: { id: senderId },
    select: { createdAt: true, lastTransactionAt: true },
  });

  const senderAge = sender
    ? (Date.now() - new Date(sender.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  const isNewAccount = senderAge <= 30;

  const daysSinceLastTx = sender?.lastTransactionAt
    ? (Date.now() - new Date(sender.lastTransactionAt).getTime()) / (1000 * 60 * 60 * 24)
    : null;
  const isInactiveAccount = daysSinceLastTx != null && daysSinceLastTx >= 90;

  const riskFlags = { isNewAccount, isInactiveAccount };

  const hasBeneficiaryScope =
    Boolean(beneficiaryCustomerId) || Boolean(beneficiaryKeyPlain) || Boolean(currentBeneficiaryKey);

  // ── THRESHOLD RULES ──────────────────────────────────────────────────────

  try {
    if (amount >= 3000) {
      triggered.push({
        code: 'T1',
        reason: `Single transaction amount $${amount.toFixed(2)} ≥ $3,000`,
        details: { amount },
      });
    }
  } catch (e) {
    console.warn('[ComplianceEngine] T1 skipped:', e.message);
  }

  try {
    if (amount >= 5000) {
      triggered.push({
        code: 'T2',
        reason: `Single transaction amount $${amount.toFixed(2)} ≥ $5,000`,
        details: { amount },
      });
    }
  } catch (e) {
    console.warn('[ComplianceEngine] T2 skipped:', e.message);
  }

  try {
    if (amount >= 10000) {
      triggered.push({
        code: 'T3',
        reason: `Single transaction amount $${amount.toFixed(2)} ≥ $10,000`,
        details: { amount },
      });
    }
  } catch (e) {
    console.warn('[ComplianceEngine] T3 skipped:', e.message);
  }

  try {
    const { total, count } = await senderSumInWindow(senderId, hoursAgo(24), excludeTransactionId);
    const projectedTotal = total + amount;
    if (count >= 1 && projectedTotal >= 5000) {
      triggered.push({
        code: 'T4',
        reason: `Sender aggregated $${projectedTotal.toFixed(2)} (≥$5,000) across ${count + 1} transactions within 24 hours`,
        details: { existingTotal: total, currentAmount: amount, projectedTotal, txCount: count + 1 },
      });
    }
  } catch (e) {
    console.warn('[ComplianceEngine] T4 skipped:', e.message);
  }

  if (hasBeneficiaryScope) {
    try {
      const { total, count } = await beneficiarySumInWindow(
        beneficiaryCustomerId,
        beneficiaryKeyPlain,
        hoursAgo(24),
        excludeTransactionId,
      );
      const projectedTotal = total + amount;
      if (count >= 1 && projectedTotal >= 5000) {
        triggered.push({
          code: 'T5',
          reason: `Beneficiary received aggregated $${projectedTotal.toFixed(2)} (≥$5,000) across ${count + 1} transactions within 24 hours`,
          details: { existingTotal: total, currentAmount: amount, projectedTotal, txCount: count + 1 },
        });
      }
    } catch (e) {
      console.warn('[ComplianceEngine] T5 skipped:', e.message);
    }
  }

  try {
    const { total, count } = await senderSumInWindow(senderId, hoursAgo(24), excludeTransactionId);
    const projectedTotal = total + amount;
    if (count >= 1 && projectedTotal >= 10000) {
      triggered.push({
        code: 'T6',
        reason: `Sender aggregated $${projectedTotal.toFixed(2)} (≥$10,000) across ${count + 1} transactions within 24 hours`,
        details: { existingTotal: total, currentAmount: amount, projectedTotal, txCount: count + 1 },
      });
    }
  } catch (e) {
    console.warn('[ComplianceEngine] T6 skipped:', e.message);
  }

  if (hasBeneficiaryScope) {
    try {
      const { total, count } = await beneficiarySumInWindow(
        beneficiaryCustomerId,
        beneficiaryKeyPlain,
        hoursAgo(24),
        excludeTransactionId,
      );
      const projectedTotal = total + amount;
      if (count >= 1 && projectedTotal >= 10000) {
        triggered.push({
          code: 'T7',
          reason: `Beneficiary received aggregated $${projectedTotal.toFixed(2)} (≥$10,000) across ${count + 1} transactions within 24 hours`,
          details: { existingTotal: total, currentAmount: amount, projectedTotal, txCount: count + 1 },
        });
      }
    } catch (e) {
      console.warn('[ComplianceEngine] T7 skipped:', e.message);
    }
  }

  // ── BEHAVIORAL RULES ─────────────────────────────────────────────────────

  try {
    const { total } = await senderSumInWindow(senderId, hoursAgo(5), excludeTransactionId);
    const projectedTotal = total + amount;
    if (projectedTotal >= 1500) {
      triggered.push({
        code: 'B1',
        reason: `Sender has sent $${projectedTotal.toFixed(2)} (≥$1,500) within the last 5 hours — rapid sending behavior`,
        details: { existingTotal: total, currentAmount: amount, projectedTotal },
      });
    }
  } catch (e) {
    console.warn('[ComplianceEngine] B1 skipped:', e.message);
  }

  if (hasBeneficiaryScope) {
    try {
      const { uniqueSenders, projectedSendTotal } = await distinctSendersToBeneficiary(
        beneficiaryCustomerId,
        beneficiaryKeyPlain,
        hoursAgo(5),
        excludeTransactionId,
        senderId,
        amount,
      );
      if (uniqueSenders >= 3 && projectedSendTotal >= 1500) {
        riskFlags.multipleIncomingSenders = true;
        triggered.push({
          code: 'B2',
          reason: `Beneficiary receiving $${projectedSendTotal.toFixed(2)} from ${uniqueSenders} different senders within 5 hours`,
          details: { uniqueSenders, totalSendUsdApprox: projectedSendTotal },
        });
      }
    } catch (e) {
      console.warn('[ComplianceEngine] B2 skipped:', e.message);
    }
  }

  try {
    const { uniqueBeneficiaries, totalAmount } = await distinctBeneficiariesFromSender(
      senderId,
      daysAgo(15),
      excludeTransactionId,
      currentBeneficiaryKey,
    );
    const projectedTotal = totalAmount + amount;
    if (uniqueBeneficiaries >= 3 && projectedTotal >= 3000) {
      riskFlags.multipleBeneficiaries = true;
      triggered.push({
        code: 'B3',
        reason: `Sender sent $${projectedTotal.toFixed(2)} to ${uniqueBeneficiaries} beneficiaries within 15 days`,
        details: { uniqueBeneficiaries, totalAmount: projectedTotal },
      });
    }
  } catch (e) {
    console.warn('[ComplianceEngine] B3 skipped:', e.message);
  }

  if (hasBeneficiaryScope) {
    try {
      const { uniqueSenders, projectedSendTotal } = await distinctSendersToBeneficiary(
        beneficiaryCustomerId,
        beneficiaryKeyPlain,
        daysAgo(15),
        excludeTransactionId,
        senderId,
        amount,
      );
      if (uniqueSenders >= 3 && projectedSendTotal >= 3000) {
        riskFlags.multipleIncomingSenders = true;
        triggered.push({
          code: 'B4',
          reason: `Beneficiary received $${projectedSendTotal.toFixed(2)} from ${uniqueSenders} senders within 15 days`,
          details: { uniqueSenders, totalAmount: projectedSendTotal },
        });
      }
    } catch (e) {
      console.warn('[ComplianceEngine] B4 skipped:', e.message);
    }
  }

  try {
    const { uniqueBeneficiaries, totalAmount } = await distinctBeneficiariesFromSender(
      senderId,
      daysAgo(15),
      excludeTransactionId,
      currentBeneficiaryKey,
    );
    const projectedTotal = totalAmount + amount;
    if (uniqueBeneficiaries >= 3 && projectedTotal >= 5000) {
      triggered.push({
        code: 'B5',
        reason: `Sender sent $${projectedTotal.toFixed(2)} to ${uniqueBeneficiaries} beneficiaries (≥$5,000) within 15 days`,
        details: { uniqueBeneficiaries, totalAmount: projectedTotal },
      });
    }
  } catch (e) {
    console.warn('[ComplianceEngine] B5 skipped:', e.message);
  }

  if (hasBeneficiaryScope) {
    try {
      const { uniqueSenders, projectedSendTotal } = await distinctSendersToBeneficiary(
        beneficiaryCustomerId,
        beneficiaryKeyPlain,
        daysAgo(15),
        excludeTransactionId,
        senderId,
        amount,
      );
      if (uniqueSenders >= 3 && projectedSendTotal >= 5000) {
        triggered.push({
          code: 'B6',
          reason: `Beneficiary received $${projectedSendTotal.toFixed(2)} from ${uniqueSenders} senders (≥$5,000) within 15 days`,
          details: { uniqueSenders, totalAmount: projectedSendTotal },
        });
      }
    } catch (e) {
      console.warn('[ComplianceEngine] B6 skipped:', e.message);
    }
  }

  try {
    if (isNewAccount) {
      const { total } = await senderSumInWindow(senderId, hoursAgo(24), excludeTransactionId);
      const projectedTotal = total + amount;
      if (projectedTotal >= 3000) {
        triggered.push({
          code: 'B7',
          reason: `New sender account (${Math.floor(senderAge)} days old) has sent $${projectedTotal.toFixed(2)} within 24 hours`,
          details: { accountAgeDays: Math.floor(senderAge), projectedTotal },
        });
      }
    }
  } catch (e) {
    console.warn('[ComplianceEngine] B7 skipped:', e.message);
  }

  if (beneficiaryCustomerId) {
    try {
      const ben = await prisma.customer.findUnique({
        where: { id: beneficiaryCustomerId },
        select: { createdAt: true },
      });
      if (ben) {
        const benAge =
          (Date.now() - new Date(ben.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (benAge <= 30) {
          const { total } = await beneficiarySumInWindow(
            beneficiaryCustomerId,
            beneficiaryKeyPlain,
            hoursAgo(24),
            excludeTransactionId,
          );
          const projectedTotal = total + amount;
          if (projectedTotal >= 3000) {
            triggered.push({
              code: 'B8',
              reason: `New beneficiary account (${Math.floor(benAge)} days old) receiving $${projectedTotal.toFixed(2)} within 24 hours`,
              details: { accountAgeDays: Math.floor(benAge), projectedTotal },
            });
          }
        }
      }
    } catch (e) {
      console.warn('[ComplianceEngine] B8 skipped:', e.message);
    }
  }

  try {
    if (isInactiveAccount) {
      const { total } = await senderSumInWindow(senderId, hoursAgo(24), excludeTransactionId);
      const projectedTotal = total + amount;
      if (projectedTotal >= 3000) {
        triggered.push({
          code: 'B9',
          reason: `Inactive sender account (last active ${Math.floor(daysSinceLastTx)} days ago) sending $${projectedTotal.toFixed(2)} within 24 hours`,
          details: { inactiveDays: Math.floor(daysSinceLastTx), projectedTotal },
        });
      }
    }
  } catch (e) {
    console.warn('[ComplianceEngine] B9 skipped:', e.message);
  }

  if (beneficiaryCustomerId) {
    try {
      const ben = await prisma.customer.findUnique({
        where: { id: beneficiaryCustomerId },
        select: { lastTransactionAt: true },
      });
      if (ben?.lastTransactionAt) {
        const benInactive =
          (Date.now() - new Date(ben.lastTransactionAt).getTime()) / (1000 * 60 * 60 * 24);
        if (benInactive >= 90) {
          const { total } = await beneficiarySumInWindow(
            beneficiaryCustomerId,
            beneficiaryKeyPlain,
            hoursAgo(24),
            excludeTransactionId,
          );
          const projectedTotal = total + amount;
          if (projectedTotal >= 3000) {
            triggered.push({
              code: 'B10',
              reason: `Inactive beneficiary account (last active ${Math.floor(benInactive)} days ago) receiving $${projectedTotal.toFixed(2)} within 24 hours`,
              details: { inactiveDays: Math.floor(benInactive), projectedTotal },
            });
          }
        }
      }
    } catch (e) {
      console.warn('[ComplianceEngine] B10 skipped:', e.message);
    }
  }

  let riskScore = computeRiskScore(amount, riskFlags);

  try {
    if (riskScore > 70) {
      triggered.push({
        code: 'RS70',
        reason: `Aggregated risk score ${riskScore} exceeds threshold (70)`,
        details: { riskScore, flags: riskFlags },
      });
    }
  } catch (e) {
    console.warn('[ComplianceEngine] RS70 skipped:', e.message);
  }

  const hold = triggered.length > 0;

  return { hold, triggeredRules: triggered, riskScore };
}

export async function createComplianceAlerts(transactionId, customerId, triggeredRules) {
  if (!triggeredRules || triggeredRules.length === 0) return;

  const data = triggeredRules.map((rule) => ({
    transactionId,
    customerId,
    ruleCode: rule.code,
    reason: rule.reason,
    details: rule.details ?? {},
    status: 'OPEN',
  }));

  await prisma.complianceAlert.createMany({ data });
}
