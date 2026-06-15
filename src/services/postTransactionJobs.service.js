/**
 * Post-transaction background work: AML, ledger, compliance, notifications.
 * Used by BullMQ workers and by inline fallback when queues are disabled.
 */

import prisma from '../utils/prisma.js';
import { createAccountingEntryFromTransaction } from '../utils/accounting.js';
import { createRemittanceInitiateJournal } from '../utils/ledgerService.js';
import { deliverCustomerNotification } from '../utils/customerNotify.js';
import { getSocketIo } from '../utils/socketIo.js';
import {
  runComplianceRules,
  createComplianceAlerts,
  extractBeneficiaryKey,
} from '../services/complianceRuleEngine.js';
import { syncRemittanceTransactionToAml } from '../services/amlTransaction.service.js';

export async function processAmlSyncJob(data) {
  const { transactionId, customerId, recipientInfo, reqMeta } = data;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return { success: false, message: 'Customer not found' };
  }

  const transaction = await prisma.remittanceTransaction.findUnique({
    where: { id: transactionId },
  });
  if (!transaction) {
    return { success: false, message: 'Transaction not found' };
  }

  const amlSync = await syncRemittanceTransactionToAml({
    customer,
    transaction,
    recipientInfo: recipientInfo || transaction.recipientInfo,
    reqMeta: reqMeta || {},
  });

  if (!amlSync?.success && !amlSync?.skipped) {
    console.warn(
      '[AML] Background sync failed | transactionId=',
      transactionId,
      '|',
      amlSync?.message,
    );
  }

  return amlSync;
}

export async function processLedgerJob(data) {
  const {
    transactionId,
    customerId,
    orchestrationJobId,
    send,
    receive,
    currency,
    feeAmount,
    totalCharge,
    taxAmount,
    transaction,
  } = data;

  const tx =
    transaction ||
    (await prisma.remittanceTransaction.findUnique({ where: { id: transactionId } }));

  if (!tx) {
    throw new Error(`Transaction not found: ${transactionId}`);
  }

  await createAccountingEntryFromTransaction(tx, 'pending', {
    totalCharge,
    tax: typeof taxAmount === 'number' ? taxAmount : undefined,
    fee: typeof feeAmount === 'number' ? feeAmount : undefined,
  });

  const sendCurrency = 'USD';
  const receiveCurrency = currency || tx.currency || 'USD';
  const sendAmount = Number(send ?? tx.sendAmount);
  const receiveAmount = Number(receive ?? tx.receiveAmount);
  const exchangeRate =
    receiveAmount > 0 && sendAmount > 0
      ? (receiveAmount / sendAmount).toFixed(6)
      : null;

  await createRemittanceInitiateJournal({
    transactionId: tx.id,
    jobId: orchestrationJobId || null,
    actorId: customerId,
    sendAmount,
    feeAmount: feeAmount || totalCharge,
    currency: sendCurrency,
    receiveAmount,
    receiveCurrency,
    exchangeRate,
  });

  const io = getSocketIo();
  if (io) {
    io.emit('accounting:updated');
  }

  return { success: true, transactionId };
}

export async function processComplianceJob(data) {
  const {
    transactionId,
    customerId,
    send,
    enrichedRecipientInfo,
    ipAddress,
    deviceId,
  } = data;

  const beneficiaryCustomerId = enrichedRecipientInfo?.beneficiaryId || null;
  const beneficiaryKeyPlain = enrichedRecipientInfo?.beneficiaryKey || null;
  const currentBeneficiaryKey = extractBeneficiaryKey(enrichedRecipientInfo);

  console.log('[Compliance] Background rules | transactionId=', transactionId, '| amount=', send);

  const { hold, triggeredRules, riskScore } = await runComplianceRules({
    senderId: customerId,
    beneficiaryCustomerId,
    beneficiaryKeyPlain,
    currentBeneficiaryKey,
    amount: send,
    excludeTransactionId: transactionId,
    ipAddress: ipAddress || null,
    deviceId: deviceId || null,
  });

  const complianceUpdate = {
    riskScore,
    triggeredRules: triggeredRules.map((r) => r.code),
    ipAddress: ipAddress || null,
    deviceId: deviceId || null,
  };

  let finalStatus = 'Processing';

  if (hold) {
    finalStatus = 'Hold';
    complianceUpdate.status = 'Hold';
    complianceUpdate.complianceHoldAt = new Date();

    await prisma.remittanceTransaction.update({
      where: { id: transactionId },
      data: complianceUpdate,
    });

    await createComplianceAlerts(transactionId, customerId, triggeredRules);

    const io = getSocketIo();
    if (io) {
      io.to(`user:${customerId}`).emit('transaction-status', {
        transactionId,
        status: 'Hold',
        message:
          'Your transaction is under compliance review. Estimated review time: 2–24 hours.',
      });
    }

    console.log(
      '[Compliance] Transaction placed on HOLD (background) | transactionId=',
      transactionId,
      '| rules=',
      triggeredRules.map((r) => r.code).join(', '),
    );
  } else {
    await prisma.remittanceTransaction.update({
      where: { id: transactionId },
      data: complianceUpdate,
    });
    console.log('[Compliance] No rules triggered (background) | transactionId=', transactionId);
  }

  return {
    transactionId,
    hold,
    finalStatus,
    riskScore,
    triggeredRules: triggeredRules.map((r) => r.code),
  };
}

export async function processNotificationJob(data) {
  const { customerId, transactionId, send, holdActive, finalStatus } = data;
  const io = getSocketIo();
  const status = finalStatus || (holdActive ? 'Hold' : 'Processing');

  const result = await deliverCustomerNotification(customerId, {
    title: holdActive ? 'Transfer under review' : 'Transfer submitted',
    body: holdActive
      ? 'Your transfer is being reviewed. We will notify you when it is updated.'
      : `Your transfer of $${Number(send).toFixed(2)} USD has been submitted and is being processed.`,
    data: {
      type: 'transaction',
      screen: 'history',
      transactionId,
      status,
    },
  });

  if (io && result.notificationId) {
    try {
      io.to(`user:${String(customerId)}`).emit('admin:notification', {
        id: result.notificationId,
        title: holdActive ? 'Transfer under review' : 'Transfer submitted',
        body: holdActive
          ? 'Your transfer is being reviewed. We will notify you when it is updated.'
          : `Your transfer of $${Number(send).toFixed(2)} USD has been submitted and is being processed.`,
        imageUrl: null,
        sentAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[Notify] Socket emit failed:', e?.message || e);
    }
  }

  return result;
}

/** Run all post-transaction jobs inline (fallback when Redis/BullMQ unavailable). */
export async function runPostTransactionJobsInline(payload) {
  const complianceResult = await processComplianceJob(payload).catch((err) => {
    console.warn('[PostTransaction] Compliance inline error:', err.message);
    return { hold: false, finalStatus: 'Processing' };
  });

  await Promise.allSettled([
    processAmlSyncJob(payload),
    processLedgerJob(payload),
    processNotificationJob({
      ...payload,
      holdActive: complianceResult.hold,
      finalStatus: complianceResult.finalStatus,
    }),
  ]);
}
