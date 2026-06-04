import prisma from './prisma.js';
import {
  resolveAmlClientNumber,
  amlGetCustomerStatus,
  mapAmlCustomerStatus,
} from '../services/amlProvider.service.js';

const GATE_ENABLED = process.env.AML_TRANSACTION_GATE_ENABLED !== 'false';

/**
 * Live AML check before any customer send transaction.
 * Only statusId 6 ("Onboarded") may proceed.
 * @param {string} customerId
 * @returns {Promise<{ allowed: boolean, message?: string, code?: string, mapped?: object, skipped?: boolean }>}
 */
export async function verifyAmlOnboardedForTransaction(customerId) {
  if (!GATE_ENABLED) {
    return { allowed: true, skipped: true };
  }

  if (!customerId) {
    return {
      allowed: false,
      message: 'AML verification is required before you can send money.',
      code: 'AML_NOT_ONBOARDED',
    };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, kycData: true },
  });

  if (!customer) {
    return {
      allowed: false,
      message: 'Customer not found.',
      code: 'AML_NOT_ONBOARDED',
    };
  }

  const clientNumber = resolveAmlClientNumber(customer);
  let amlRaw;
  try {
    amlRaw = await amlGetCustomerStatus(clientNumber);
  } catch (error) {
    console.warn('[AML] Transaction gate: provider unreachable:', error.message);
    return {
      allowed: false,
      message:
        'AML verification is required before you can send money. The compliance service is temporarily unavailable. Please try again shortly.',
      code: 'AML_VERIFICATION_UNAVAILABLE',
    };
  }

  if (amlRaw?.isError) {
    return {
      allowed: false,
      message:
        amlRaw.message ||
        'AML verification failed. Complete compliance review before sending money.',
      code: 'AML_NOT_ONBOARDED',
    };
  }

  const mapped = mapAmlCustomerStatus(amlRaw);
  if (mapped.isOnboarded) {
    return { allowed: true, mapped, clientNumber };
  }

  if (mapped.isBlocked) {
    return {
      allowed: false,
      message:
        'Your account is blocked by compliance review. Contact support for assistance.',
      code: 'AML_CUSTOMER_BLOCKED',
      mapped,
    };
  }

  if (mapped.isFrozen) {
    return {
      allowed: false,
      message: `Your account is under compliance review (${mapped.statusLabel || 'pending'}). You cannot send money until AML verification is complete.`,
      code: 'AML_COMPLIANCE_PENDING',
      mapped,
    };
  }

  return {
    allowed: false,
    message: `AML verification required. Your status is "${mapped.statusLabel || 'Pending'}". You must be onboarded in AML before sending money.`,
    code: 'AML_NOT_ONBOARDED',
    mapped,
  };
}
