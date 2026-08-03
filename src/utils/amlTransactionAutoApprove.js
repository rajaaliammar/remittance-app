/**
 * Auto-complete / hold / fail remittance transactions from LiveEx TMS status.
 * Policy mirrors customer auto-approve: statusId >= 1 (except rejected/hold).
 */

import prisma from './prisma.js';
import { updateAccountingEntriesForTransactionStatus } from './accounting.js';
import { createRemittanceCompleteJournal } from './ledgerService.js';
import { deliverCustomerNotification } from './customerNotify.js';
import { getSocketIo } from './socketIo.js';

/** TMS transaction statuses that must not auto-complete. */
export const AML_TX_REJECTED_STATUS_ID = 4;
export const AML_TX_HOLD_STATUS_ID = 5;
export const AML_TX_CASE_STATUS_ID = 11;

const TERMINAL_LOCAL = new Set([
  'completed',
  'failed',
  'refunded',
  'canceled',
  'cancelled',
  'rejected',
]);

/**
 * - statusId >= 1 and not 4/5/11 → auto-complete (Completed)
 * - statusId 5 or 11 → Hold
 * - statusId 4 → Failed
 * - statusId 0 / null → leave as-is
 */
export function resolveRemittanceStatusFromAml(mapped) {
  if (!mapped) return null;

  const statusId = Number(mapped.statusId);
  if (!Number.isFinite(statusId)) return null;

  if (statusId === AML_TX_REJECTED_STATUS_ID) return 'Failed';
  if (statusId === AML_TX_HOLD_STATUS_ID || statusId === AML_TX_CASE_STATUS_ID) {
    return 'Hold';
  }
  if (statusId >= 1) return 'Completed';
  return null;
}

export function shouldAutoCompleteRemittanceFromAml(mapped) {
  return resolveRemittanceStatusFromAml(mapped) === 'Completed';
}

/**
 * Apply AML-driven local status. Skips if already terminal, or if local Hold
 * would be overwritten by Completed (compliance hold wins until manually released).
 */
export async function maybeAutoApproveRemittanceFromAml(
  transactionId,
  mapped,
  opts = {},
) {
  const target = resolveRemittanceStatusFromAml(mapped);
  if (!target) {
    return { applied: false, reason: 'no_qualifying_status' };
  }

  const row = await prisma.remittanceTransaction.findUnique({
    where: { id: transactionId },
  });
  if (!row) {
    return { applied: false, reason: 'not_found' };
  }

  const current = String(row.status || '').toLowerCase();
  if (TERMINAL_LOCAL.has(current)) {
    return { applied: false, reason: 'already_terminal', status: row.status };
  }

  // Compliance hold: do not auto-complete until compliance releases
  if (current === 'hold' && target === 'Completed') {
    return { applied: false, reason: 'compliance_hold', status: row.status };
  }

  if (current === target.toLowerCase()) {
    return { applied: false, reason: 'unchanged', status: row.status };
  }

  const updated = await prisma.remittanceTransaction.update({
    where: { id: transactionId },
    data: {
      status: target,
      updatedAt: new Date(),
      ...(target === 'Hold' ? { complianceHoldAt: row.complianceHoldAt || new Date() } : {}),
    },
  });

  if (target === 'Completed') {
    await runCompletionSideEffects(row, opts.actorId || 'aml-tx-auto');
  } else if (target === 'Failed') {
    try {
      await updateAccountingEntriesForTransactionStatus(transactionId, 'Failed');
    } catch (err) {
      console.warn('[AML-TX] Accounting on auto-fail skipped:', err.message);
    }
  }

  const io = getSocketIo();
  if (io) {
    try {
      io.emit('accounting:updated');
      if (row.customerId) {
        io.to(`user:${row.customerId}`).emit('transaction-status', {
          transactionId,
          status: target,
          message:
            target === 'Completed'
              ? 'Your money transfer has been completed successfully.'
              : target === 'Hold'
                ? 'Your transfer is under review.'
                : 'Your transfer could not be completed.',
        });
      }
    } catch {
      /* optional */
    }
  }

  if (row.customerId) {
    const title =
      target === 'Completed'
        ? 'Transfer completed'
        : target === 'Hold'
          ? 'Transfer under review'
          : 'Transfer not completed';
    const body =
      target === 'Completed'
        ? 'Your money transfer has been completed successfully.'
        : target === 'Hold'
          ? 'Your transfer is under compliance review. We will notify you when it is updated.'
          : `Your transfer could not be completed (status: ${target}).`;
    void deliverCustomerNotification(row.customerId, {
      title,
      body,
      data: {
        type: 'transaction',
        screen: 'history',
        transactionId,
        status: target,
      },
    }).catch(() => {});
  }

  console.log(
    `[AML-TX] Auto-set transaction ${transactionId} → ${target} (AML statusId=${mapped?.statusId})`,
  );

  return {
    applied: true,
    status: updated.status,
    previousStatus: row.status,
    statusId: mapped?.statusId,
  };
}

async function runCompletionSideEffects(transaction, actorId) {
  const id = transaction.id;
  try {
    await prisma.$executeRaw`
      UPDATE customers SET "lastTransactionAt" = NOW(), "updatedAt" = NOW()
      WHERE id = ${transaction.customerId}
    `;
  } catch (e) {
    console.warn('[AML-TX] lastTransactionAt update skipped:', e.message);
  }

  try {
    await updateAccountingEntriesForTransactionStatus(id, 'Completed');
  } catch (accErr) {
    console.warn('[AML-TX] Accounting on complete skipped:', accErr.message);
  }

  try {
    let jobId = null;
    if (prisma.orchestrationJob && typeof prisma.orchestrationJob.findFirst === 'function') {
      const job = await prisma.orchestrationJob.findFirst({
        where: { remittanceTransactionId: id },
        select: { id: true },
      });
      jobId = job?.id;
    }

    const sendAmount = Number(transaction.sendAmount ?? 0);
    const receiveAmount = Number(transaction.receiveAmount ?? 0);
    const receiveCurrency = transaction.currency || 'USD';
    const exchangeRate = transaction.exchangeRate
      ? Number(transaction.exchangeRate)
      : sendAmount > 0 && receiveAmount > 0
        ? receiveAmount / sendAmount
        : null;
    const paymentFieldValues =
      transaction.paymentFieldValues && typeof transaction.paymentFieldValues === 'object'
        ? transaction.paymentFieldValues
        : {};
    const costRate =
      paymentFieldValues.costRate || paymentFieldValues.cost_rate || exchangeRate;
    const offeredRate =
      paymentFieldValues.offeredRate ||
      paymentFieldValues.offered_rate ||
      exchangeRate ||
      costRate;
    const payoutPartnerId =
      paymentFieldValues.payoutPartnerId ||
      paymentFieldValues.payout_partner_id ||
      'payout_partner_id';

    await createRemittanceCompleteJournal({
      transactionId: id,
      jobId,
      actorId,
      sendAmount,
      receiveAmount,
      receiveCurrency,
      costRate: costRate ? Number(costRate) : null,
      offeredRate: offeredRate ? Number(offeredRate) : null,
      payoutPartnerId,
    });
  } catch (ledgerErr) {
    console.warn('[AML-TX] Phase 2 complete journal failed:', ledgerErr.message);
  }
}
