/**
 * Same-rail refund safety
 *
 * Collected funds must be returned on the SAME rail they were taken from:
 *  - WALLET: atomic SQL credit (`availableBalance = availableBalance + amount`).
 *  - CARD / Accept.blue: Void (unsettled) or Refund (settled) at the processor.
 *
 * Never credit the in-app wallet for a card-funded remittance. Doing so would let
 * an attacker convert a reversible card charge into spendable wallet cash
 * (card refund exploitation).
 *
 * If the Accept.blue void/refund fails, this module throws and callers MUST NOT
 * mark the remittance as refunded / failed.
 */

import acceptblueService from '../services/acceptblue.service.js';
import { creditCustomerWallet } from './walletLock.js';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function getPaymentFieldValues(transaction) {
  return asObject(transaction?.paymentFieldValues);
}

export function getRefundAmount(transaction) {
  const sendAmount = Number(transaction?.sendAmount ?? 0);
  const recipientInfo = asObject(transaction?.recipientInfo);
  const paymentFieldValues = getPaymentFieldValues(transaction);
  const fee = Number(
    recipientInfo.fee ?? paymentFieldValues.charge ?? paymentFieldValues.fee ?? 0,
  );
  return sendAmount + fee;
}

/**
 * Resolve funding rail. Prefer the stored `fundingSource`, then Accept.blue /
 * saved-card markers. Unknown sources default to WALLET only when there is no
 * card evidence — card evidence always wins so we never mis-credit a card txn.
 */
export function getFundingSource(transaction) {
  const pfv = getPaymentFieldValues(transaction);
  const explicit = String(pfv.fundingSource || pfv.paymentSource || pfv.payment_source || '')
    .trim()
    .toUpperCase();
  if (explicit === 'CARD' || explicit === 'WALLET') return explicit;

  const hasAcceptBlueCharge = Boolean(
    pfv.acceptblueTransactionId ||
      pfv.acceptblueReferenceNumber ||
      pfv.reference_number ||
      pfv.transaction_id,
  );
  const hasSavedCard = Boolean(pfv.paymentMethodId || pfv.savedCardId);
  if (hasAcceptBlueCharge || hasSavedCard || explicit === 'ACCEPT.BLUE' || explicit === 'ACCEPTBLUE') {
    return 'CARD';
  }
  return 'WALLET';
}

export function getAcceptBlueChargeId(transaction) {
  const pfv = getPaymentFieldValues(transaction);
  return (
    pfv.acceptblueTransactionId ||
    pfv.acceptblueReferenceNumber ||
    pfv.reference_number ||
    pfv.transaction_id ||
    null
  );
}

function sanitizeProviderResponse(response) {
  if (!response || typeof response !== 'object') return response ?? null;
  return {
    id: response.id ?? null,
    status: response.status ?? null,
    reference_number: response.reference_number ?? response.referenceNumber ?? null,
    error_message: response.error_message ?? response.errorMessage ?? null,
    error_code: response.error_code ?? response.errorCode ?? null,
    auth_code: response.auth_code ?? response.authCode ?? null,
    version: response.version ?? null,
  };
}

/**
 * Call Accept.blue Void/Refund using the original charge reference.
 * Does not touch the customer wallet. Throws with the provider message on failure.
 */
export async function refundCardViaAcceptBlue(transaction, amount) {
  const chargeId = getAcceptBlueChargeId(transaction);
  if (!chargeId) {
    const err = new Error(
      'Cannot void/refund card payment: missing Accept.blue transaction reference. Wallet will not be credited.',
    );
    err.status = 400;
    err.code = 'MISSING_CARD_CHARGE_REF';
    throw err;
  }

  try {
    return await acceptblueService.voidOrRefund({
      reference_number: chargeId,
      amount,
    });
  } catch (e) {
    console.error('[Accept.blue] Same-rail void/refund failed:', e?.message || e);
    const err = new Error(
      e.message || 'Accept.blue void/refund failed. Transaction was not marked refunded.',
    );
    err.status = e.status || 502;
    err.code = e.code || 'ACCEPTBLUE_REFUND_FAILED';
    err.details = e.details;
    throw err;
  }
}

/**
 * Provider / wallet side of a same-rail refund.
 * CARD: talks to Accept.blue first (no DB writes). WALLET: no provider call.
 * Callers then persist status only after this succeeds.
 */
export async function prepareSameRailRefund(transaction) {
  const refundAmount = getRefundAmount(transaction);
  const fundingSource = getFundingSource(transaction);
  const pfv = getPaymentFieldValues(transaction);

  if (fundingSource === 'CARD') {
    const provider = await refundCardViaAcceptBlue(transaction, refundAmount);
    const refundReference =
      provider.response?.reference_number ??
      provider.response?.referenceNumber ??
      provider.response?.id ??
      null;
    const originalReference = provider.originalReference ?? getAcceptBlueChargeId(transaction);
    const providerStatus = provider.response?.status ?? null;
    const paymentFieldValues = {
      ...pfv,
      fundingSource: 'CARD',
      acceptblueRefundNote: `Accept.blue ${provider.method} ${providerStatus || 'ok'} originalRef=${originalReference} refundRef=${refundReference} at ${new Date().toISOString()}`,
      acceptblueRefund: {
        method: provider.method,
        at: new Date().toISOString(),
        originalReference,
        refundReference,
        status: providerStatus,
        errorMessage: provider.response?.error_message ?? provider.response?.errorMessage ?? null,
        errorCode: provider.response?.error_code ?? provider.response?.errorCode ?? null,
        response: sanitizeProviderResponse(provider.response),
      },
    };
    console.log(
      '[Accept.blue] Same-rail',
      provider.method,
      'originalRef=',
      originalReference,
      'status=',
      providerStatus,
    );
    return {
      fundingSource: 'CARD',
      refundAmount,
      paymentFieldValues,
      walletCredit: false,
      provider,
    };
  }

  return {
    fundingSource: 'WALLET',
    refundAmount,
    paymentFieldValues: { ...pfv, fundingSource: 'WALLET' },
    walletCredit: true,
    provider: null,
  };
}

/**
 * Persist the refund inside an existing Prisma interactive transaction.
 * WALLET: atomic credit then status update.
 * CARD: status / notes only — wallet is never credited.
 */
export async function commitSameRailRefund(tx, {
  transactionId,
  customerId,
  prepared,
  status,
  extraData = {},
}) {
  let newBalance = null;
  if (prepared.walletCredit) {
    // Same-rail WALLET: credit only funds that were originally debited from the wallet.
    const creditResult = await creditCustomerWallet(tx, customerId, prepared.refundAmount);
    newBalance = creditResult.newBalance;
  }

  const updated = await tx.remittanceTransaction.update({
    where: { id: transactionId },
    data: {
      ...extraData,
      status,
      paymentFieldValues: prepared.paymentFieldValues,
      updatedAt: new Date(),
    },
  });

  return { updated, newBalance };
}

export function sameRailRefundMessage(fundingSource, action = 'refunded') {
  if (fundingSource === 'CARD') {
    return `Transaction ${action}. Card was reversed via Accept.blue; wallet was not credited.`;
  }
  return `Transaction ${action}. Customer wallet balance has been credited.`;
}
