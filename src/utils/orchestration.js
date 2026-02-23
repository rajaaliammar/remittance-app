/**
 * Orchestration runs before every remittance transaction (see docs/ORCHESTRATION.md).
 * Use this to enforce policies, run validations, log, or integrate external checks.
 * @param {Object} context - Transaction context (customerId, amounts, currency, etc.)
 * @returns {Promise<{ allowed: boolean, message?: string }>}
 */
const LOG_PREFIX = '[Orchestration]';

export const runOrchestrationBeforeTransaction = async (context) => {
  const {
    customerId,
    sendAmount,
    receiveAmount,
    currency,
    gatewayId,
    gatewayName,
    transferType,
    countryId,
    recipientInfo,
  } = context || {};

  console.log(`${LOG_PREFIX} runOrchestrationBeforeTransaction started | customerId=${customerId ?? 'n/a'} | sendAmount=${sendAmount ?? 'n/a'} | currency=${currency ?? 'n/a'} | transferType=${transferType ?? 'n/a'}`);

  // Optional: add external checks, compliance hooks, or logging here
  // Example: await complianceCheck({ customerId, sendAmount, currency });

  if (!customerId || sendAmount == null) {
    console.log(`${LOG_PREFIX} DENIED | reason=missing_context (customerId or sendAmount)`);
    return { allowed: false, message: 'Orchestration: missing required context (customerId or sendAmount).' };
  }

  if (Number(sendAmount) < 0) {
    console.log(`${LOG_PREFIX} DENIED | reason=invalid_send_amount`);
    return { allowed: false, message: 'Orchestration: invalid send amount.' };
  }

  console.log(`${LOG_PREFIX} ALLOWED | customerId=${customerId}`);
  // Default: allow the transaction to proceed
  return { allowed: true };
};
