/**
 * Ledger Service - Integration with external ledger API
 * 
 * This service handles journal entry creation for remittance transactions
 * across three phases: initiate, complete, and refund.
 */

const LEDGER_BASE_URL = process.env.LEDGER_BASE_URL || 'http://demo3.appliedline.com';
const LEDGER_TOKEN_REMITTANCE_INITIATE = process.env.LEDGER_TOKEN_REMITTANCE_INITIATE || 'LEDGER_TOKEN_REMITTANCE';
const LEDGER_TOKEN_REMITTANCE_COMPLETE = process.env.LEDGER_TOKEN_REMITTANCE_COMPLETE || 'LEDGER_TOKEN_REMITTANCE';
const LEDGER_TOKEN_REMITTANCE_REFUND = process.env.LEDGER_TOKEN_REMITTANCE_REFUND || 'LEDGER_TOKEN_REMITTANCE';

/**
 * Make a request to the ledger API
 */
async function callLedgerAPI(endpoint, token, payload) {
  try {
    const url = `${LEDGER_BASE_URL}${endpoint}`;
    
    console.log(`[Ledger Service] Making API call to: ${url}`);
    console.log(`[Ledger Service] Using token: ${token ? `${token.substring(0, 10)}...` : 'NO TOKEN'}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.log(`[Ledger Service] API Response Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Ledger Service] API Error Response:', errorText);
      throw new Error(`Ledger API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error('[Ledger Service] API call failed:', error.message);
    console.error('[Ledger Service] Full error:', error);
    throw error;
  }
}

/**
 * Phase 1: Remittance Initiate
 * Called when a remittance transaction is created
 * 
 * @param {Object} params
 * @param {string} params.transactionId - Transaction ID
 * @param {string} params.jobId - Orchestration job ID (optional)
 * @param {string} params.actorId - Customer ID who initiated
 * @param {number} params.sendAmount - Amount being sent (principal in USD)
 * @param {number} params.feeAmount - Fee amount
 * @param {string} params.currency - Send currency code (default: USD)
 * @param {number} params.receiveAmount - Amount to be received (optional, for narration)
 * @param {string} params.receiveCurrency - Receive currency code (optional, for narration)
 * @param {string|number} params.exchangeRate - Exchange rate (optional, for narration)
 */
export async function createRemittanceInitiateJournal(params) {
  const {
    transactionId,
    jobId,
    actorId,
    sendAmount,
    feeAmount,
    currency = 'USD',
    receiveAmount,
    receiveCurrency,
    exchangeRate,
  } = params;

  if (!LEDGER_TOKEN_REMITTANCE_INITIATE) {
    console.warn('[Ledger Service] LEDGER_TOKEN_REMITTANCE_INITIATE not configured, skipping journal entry');
    return { success: false, skipped: true, reason: 'Token not configured' };
  }

  const totalDeducted = sendAmount + feeAmount;
  const externalId = `${transactionId}_remittance_initiate_v1`;

  const payload = {
    externalId,
    type: 'remittance_initiate',
    currency, // Always USD for sending
    refs: {
      transactionId,
      ...(jobId && { jobId }),
      actorId,
    },
    entries: [
      {
        account: { type: 'WALLET_LIABILITY', refId: actorId },
        credit: totalDeducted,
        narration: `Total deducted from sender (${sendAmount} principal + ${feeAmount} fee)`,
      },
      {
        account: { type: 'REMITTANCE_PAYABLE', refId: transactionId },
        debit: sendAmount,
        narration: 'Payout obligation to beneficiary',
      },
      {
        account: { type: 'FEE_REVENUE', refId: 'platform' },
        debit: feeAmount,
        narration: 'Transfer fee earned',
      },
    ],
    narration: `Remittance initiated – ${actorId} sends ${sendAmount} ${currency}${receiveAmount && receiveCurrency ? ` → ${receiveAmount} ${receiveCurrency}` : ''}${exchangeRate ? ` @ ${exchangeRate}` : ''}`,
  };

  // Console log the payload being sent
  console.log('[Ledger Service] Phase 1 (initiate) - Payload being sent:');
  console.log(JSON.stringify(payload, null, 2));

  try {
    const result = await callLedgerAPI('/v1/ledger/journals', LEDGER_TOKEN_REMITTANCE_INITIATE, payload);
    
    // Console log the response received
    console.log('[Ledger Service] Phase 1 (initiate) - Response received:');
    console.log(JSON.stringify(result, null, 2));
    console.log(`[Ledger Service] Phase 1 (initiate) journal created for transaction ${transactionId}`);
    
    return result;
  } catch (error) {
    console.error(`[Ledger Service] Failed to create Phase 1 journal for ${transactionId}:`, error.message);
    console.error('[Ledger Service] Phase 1 (initiate) - Error details:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Phase 2: Remittance Complete
 * Called when a remittance transaction is completed/settled
 * 
 * @param {Object} params
 * @param {string} params.transactionId - Transaction ID
 * @param {string} params.jobId - Orchestration job ID (optional)
 * @param {string} params.actorId - User ID who completed (backoffice/admin)
 * @param {number} params.sendAmount - Amount sent (USD)
 * @param {number} params.receiveAmount - Amount received in destination currency
 * @param {string} params.receiveCurrency - Destination currency (e.g., ETB)
 * @param {number} params.costRate - FX rate at cost (e.g., 57.50)
 * @param {number} params.offeredRate - FX rate offered to customer (e.g., 57.00)
 * @param {string} params.payoutPartnerId - Payout partner identifier
 */
export async function createRemittanceCompleteJournal(params) {
  const {
    transactionId,
    jobId,
    actorId,
    sendAmount,
    receiveAmount,
    receiveCurrency,
    costRate,
    offeredRate,
    payoutPartnerId = 'payout_partner_id',
  } = params;

  if (!LEDGER_TOKEN_REMITTANCE_COMPLETE) {
    console.warn('[Ledger Service] LEDGER_TOKEN_REMITTANCE_COMPLETE not configured, skipping journal entry');
    return { success: false, skipped: true, reason: 'Token not configured' };
  }

  const externalId = `${transactionId}_remittance_complete_v1`;

  // Calculate FX amounts
  const etbAtCost = sendAmount * (costRate || offeredRate || 1); // Fallback to offeredRate if costRate not provided
  const etbDisbursed = sendAmount * (offeredRate || 1);
  const fxGain = etbAtCost - etbDisbursed;

  const payload = {
    externalId,
    type: 'remittance_complete',
    currency: 'USD',
    refs: {
      transactionId,
      ...(jobId && { jobId }),
      actorId,
    },
    entries: [
      {
        account: { type: 'REMITTANCE_PAYABLE', refId: transactionId },
        credit: sendAmount,
        currency: 'USD',
        narration: 'USD payout obligation cleared',
      },
      {
        account: { type: 'FX_CLEARING', refId: transactionId },
        debit: sendAmount,
        currency: 'USD',
        narration: 'USD moved into FX conversion pool',
      },
      {
        account: { type: 'FX_CLEARING', refId: transactionId },
        credit: etbAtCost,
        currency: receiveCurrency || 'ETB',
        narration: `${receiveCurrency || 'ETB'} sourced at cost rate ${costRate || offeredRate || 'N/A'} (${sendAmount} × ${costRate || offeredRate || 'N/A'})`,
      },
      {
        account: { type: 'SETTLEMENT_CLEARING', refId: payoutPartnerId },
        debit: etbDisbursed,
        currency: receiveCurrency || 'ETB',
        narration: `${receiveCurrency || 'ETB'} disbursed to payout partner at offered rate ${offeredRate || 'N/A'} (${sendAmount} × ${offeredRate || 'N/A'})`,
      },
      ...(fxGain > 0 ? [{
        account: { type: 'FX_GAIN_REVENUE', refId: 'platform' },
        debit: fxGain,
        currency: receiveCurrency || 'ETB',
        narration: `FX spread captured (${etbAtCost} - ${etbDisbursed} ${receiveCurrency || 'ETB'})`,
      }] : []),
    ],
    narration: `Remittance settled – ${sendAmount} USD converted, ${etbDisbursed} ${receiveCurrency || 'ETB'} disbursed${fxGain > 0 ? `, ${fxGain} ${receiveCurrency || 'ETB'} FX gain` : ''}`,
  };

  try {
    const result = await callLedgerAPI('/v1/ledger/journals', LEDGER_TOKEN_REMITTANCE_COMPLETE, payload);
    console.log(`[Ledger Service] Phase 2 (complete) journal created for transaction ${transactionId}`);
    return result;
  } catch (error) {
    console.error(`[Ledger Service] Failed to create Phase 2 journal for ${transactionId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Phase 3: Remittance Refund
 * Called when a remittance transaction is refunded/rejected (before completion)
 * 
 * @param {Object} params
 * @param {string} params.transactionId - Transaction ID
 * @param {string} params.jobId - Orchestration job ID (optional)
 * @param {string} params.actorId - User ID who processed refund (backoffice/admin)
 * @param {number} params.sendAmount - Amount sent (principal)
 * @param {number} params.feeAmount - Fee amount to reverse
 * @param {string} params.customerId - Customer ID to refund
 * @param {string} params.currency - Currency code (default: USD)
 */
export async function createRemittanceRefundJournal(params) {
  const {
    transactionId,
    jobId,
    actorId,
    sendAmount,
    feeAmount,
    customerId,
    currency = 'USD',
  } = params;

  if (!LEDGER_TOKEN_REMITTANCE_REFUND) {
    console.warn('[Ledger Service] LEDGER_TOKEN_REMITTANCE_REFUND not configured, skipping journal entry');
    return { success: false, skipped: true, reason: 'Token not configured' };
  }

  const totalRefund = sendAmount + feeAmount;
  const externalId = `${transactionId}_remittance_refund_v1`;

  const payload = {
    externalId,
    type: 'remittance_refund',
    currency,
    refs: {
      transactionId,
      ...(jobId && { jobId }),
      actorId,
    },
    entries: [
      {
        account: { type: 'REMITTANCE_PAYABLE', refId: transactionId },
        credit: sendAmount,
        narration: 'Payout obligation cleared on refund',
      },
      {
        account: { type: 'FEE_REVENUE', refId: 'platform' },
        credit: feeAmount,
        narration: 'Fee reversed on refund',
      },
      {
        account: { type: 'WALLET_LIABILITY', refId: customerId },
        debit: totalRefund,
        narration: 'Full refund returned to customer wallet',
      },
    ],
    narration: `Remittance refunded – ${totalRefund} ${currency} returned to ${customerId}`,
  };

  try {
    const result = await callLedgerAPI('/v1/ledger/journals', LEDGER_TOKEN_REMITTANCE_REFUND, payload);
    console.log(`[Ledger Service] Phase 3 (refund) journal created for transaction ${transactionId}`);
    return result;
  } catch (error) {
    console.error(`[Ledger Service] Failed to create Phase 3 journal for ${transactionId}:`, error.message);
    return { success: false, error: error.message };
  }
}
