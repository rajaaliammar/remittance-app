import prisma from '../utils/prisma.js';
import {
  amlSaveCustomer,
  amlGetCustomerStatus,
  amlSaveTransaction,
  amlUpdateTransactionStatus,
  mapAmlTransactionStatus,
} from './amlProvider.service.js';
import { buildNaturalCustomerSavePayload } from './amlCustomer.builder.js';
import {
  buildRemittanceTransactionSavePayload,
  extractAmlSaveResult,
} from './amlTransaction.builder.js';
import { resolveAmlClientNumber } from './amlProvider.service.js';
import { maybeAutoApproveRemittanceFromAml } from '../utils/amlTransactionAutoApprove.js';

const AML_TX_SYNC_ENABLED = process.env.AML_TRANSACTION_SYNC_ENABLED !== 'false';

function isAmlTransactionSyncEnabled() {
  return AML_TX_SYNC_ENABLED;
}

async function ensureCustomerInAml(customer) {
  const clientNumber = resolveAmlClientNumber(customer);
  try {
    const status = await amlGetCustomerStatus(clientNumber);
    if (!status?.isError && (status?.statusId === 6 || status?.customerStatus)) {
      return { ok: true, clientNumber, existed: true };
    }
  } catch {
    /* try save */
  }

  const payload = buildNaturalCustomerSavePayload(customer);
  const saveRaw = await amlSaveCustomer(payload);
  if (saveRaw?.isError) {
    const msg = String(saveRaw.message || '').toLowerCase();
    if (msg.includes('already exists')) {
      return { ok: true, clientNumber, existed: true, provider: saveRaw };
    }
    return {
      ok: false,
      clientNumber,
      message: saveRaw.message || 'AML customer save failed',
      provider: saveRaw,
    };
  }
  return { ok: true, clientNumber, existed: false, provider: saveRaw };
}

/**
 * Submit remittance to LiveEx TMS. Never throws — returns result object.
 */
export async function syncRemittanceTransactionToAml({
  customer,
  transaction,
  recipientInfo,
  reqMeta,
}) {
  if (!isAmlTransactionSyncEnabled()) {
    return { skipped: true, reason: 'AML_TRANSACTION_SYNC_ENABLED=false' };
  }

  if (!customer?.id || !transaction?.id) {
    return { skipped: true, reason: 'missing customer or transaction' };
  }

  try {
    const onboard = await ensureCustomerInAml(customer);
    if (!onboard.ok) {
      return {
        success: false,
        message: onboard.message || 'Customer not onboarded in AML',
        provider: onboard.provider,
      };
    }

    const payload = buildRemittanceTransactionSavePayload({
      customer,
      transaction,
      recipientInfo,
      reqMeta,
    });
    const internalRef = payload._meta?.internalRef;
    delete payload._meta;

    const saveRaw = await amlSaveTransaction(payload);
    const extracted = extractAmlSaveResult(saveRaw);

    if (saveRaw?.isError) {
      return {
        success: false,
        message: saveRaw.message || 'AML transaction save failed',
        messageCode: saveRaw.messageCode,
        internalRef,
        provider: saveRaw,
      };
    }

    const trIdDisplay =
      extracted.trIdDisplay || extracted.internalRef || internalRef;

    const amlBlock = {
      syncedAt: new Date().toISOString(),
      clientNumber: onboard.clientNumber,
      trIdDisplay,
      internalRef: extracted.internalRef || internalRef,
      status: extracted.status,
      statusId: extracted.statusId,
      lastSaveResponse: saveRaw,
    };

    const existingPfv =
      transaction.paymentFieldValues &&
      typeof transaction.paymentFieldValues === 'object'
        ? transaction.paymentFieldValues
        : {};

    await prisma.remittanceTransaction.update({
      where: { id: transaction.id },
      data: {
        paymentFieldValues: {
          ...existingPfv,
          aml: amlBlock,
          amlTrIdDisplay: trIdDisplay,
        },
      },
    });

    console.log(
      '[AML] Transaction saved to TMS | localId=',
      transaction.id,
      '| trIdDisplay=',
      trIdDisplay,
      '| status=',
      extracted.status,
    );

    const mapped = mapAmlTransactionStatus(saveRaw);
    // Prefer extracted statusId when map misses fields
    if (mapped.statusId == null && extracted.statusId != null) {
      mapped.statusId = extracted.statusId;
    }
    if (!mapped.statusLabel && extracted.status) {
      mapped.statusLabel = extracted.status;
    }

    const auto = await maybeAutoApproveRemittanceFromAml(transaction.id, mapped, {
      actorId: 'aml-tx-sync-auto',
    });

    return {
      success: true,
      trIdDisplay,
      internalRef: amlBlock.internalRef,
      status: extracted.status,
      statusId: extracted.statusId ?? mapped.statusId,
      mapped,
      autoApprove: auto,
      provider: saveRaw,
    };
  } catch (error) {
    console.error('[AML] syncRemittanceTransactionToAml:', error.message);
    return {
      success: false,
      message: error.message || 'AML transaction sync failed',
      error: error.data,
    };
  }
}

/** Manual AML status update (compliance) via TMS update-status. */
export async function submitAmlTransactionStatusUpdate({
  transactionRefNo,
  remarks,
}) {
  return amlUpdateTransactionStatus({
    transactionRefNo: String(transactionRefNo || '').trim(),
    transactionReamrks: String(remarks || '').trim(),
  });
}

export async function syncRemittanceById(transactionId, reqMeta = {}) {
  const row = await prisma.remittanceTransaction.findUnique({
    where: { id: transactionId },
    include: {
      customer: true,
    },
  });
  if (!row) {
    return { success: false, message: 'Remittance transaction not found' };
  }
  return syncRemittanceTransactionToAml({
    customer: row.customer,
    transaction: row,
    recipientInfo: row.recipientInfo,
    reqMeta,
  });
}

export { isAmlTransactionSyncEnabled };
