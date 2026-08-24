import prisma from './prisma.js';
import {
  resolveAmlClientNumber,
  amlGetCustomerStatus,
  mapAmlCustomerStatus,
} from '../services/amlProvider.service.js';
import {
  AML_BLOCKED_STATUS_IDS,
  kycDataSatisfiesVerification,
  shouldAutoApproveFromAmlStatus,
} from './amlAutoApprove.js';

const GATE_ENABLED = process.env.AML_TRANSACTION_GATE_ENABLED !== 'false';

/**
 * Prefer live AML status; when the provider is down or still incomplete,
 * honor the same local clearance the app uses for "Verified / full limits"
 * (customer.status=approved and/or LiveEx/KYC docs approved).
 */
function extractCachedAmlMapped(kycData) {
  const entries = Array.isArray(kycData)
    ? kycData
    : kycData && typeof kycData === 'object'
      ? [kycData]
      : [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const aml = entries[i]?.aml;
    if (!aml || typeof aml !== 'object') continue;
    if (aml.mapped && typeof aml.mapped === 'object') return aml.mapped;
    if (aml.statusId != null || aml.statusLabel) {
      return {
        statusId: aml.statusId,
        statusLabel: aml.statusLabel || aml.customerStatus,
        isBlocked: aml.isBlocked,
      };
    }
  }
  return null;
}

function localSendClearance(customer) {
  const status = String(customer?.status || '').toLowerCase();
  if (
    status === 'rejected' ||
    status === 'blocked' ||
    status === 'disabled' ||
    status === 'suspended'
  ) {
    return { allowed: false, reason: 'local_blocked', status };
  }

  const kycOk = kycDataSatisfiesVerification(customer?.kycData);
  const approved = status === 'approved';

  if (approved || kycOk) {
    return { allowed: true, approved, kycOk, status };
  }

  return { allowed: false, reason: 'local_pending', status };
}

function allowFromLocal(customer, source) {
  const local = localSendClearance(customer);
  if (!local.allowed) return null;
  console.log(
    `[AML] Transaction gate: allowing via ${source} | customerId=${customer.id} | status=${local.status} | kycOk=${local.kycOk}`,
  );
  return {
    allowed: true,
    fallback: source,
    mapped: {
      statusId: null,
      statusLabel: local.approved ? 'Locally approved' : 'KYC/LiveEx verified',
    },
  };
}

/**
 * Live AML check before any customer send transaction.
 * - Live statusId >= 1 (and not blocked) → allow
 * - Live blocked (7/8/9) → deny
 * - Provider unreachable / incomplete → fall back to cached AML or local Approved/LiveEx
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
    select: { id: true, status: true, kycData: true },
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

    const cached = extractCachedAmlMapped(customer.kycData);
    if (shouldAutoApproveFromAmlStatus(cached)) {
      console.log(
        `[AML] Transaction gate: provider down — using cached AML status | customerId=${customer.id} | statusId=${cached.statusId}`,
      );
      return { allowed: true, mapped: cached, clientNumber, fallback: 'cached_aml' };
    }

    const localAllow = allowFromLocal(customer, 'local_approval_provider_down');
    if (localAllow) return { ...localAllow, clientNumber };

    return {
      allowed: false,
      message:
        'AML verification is required before you can send money. The compliance service is temporarily unavailable. Please try again shortly.',
      code: 'AML_VERIFICATION_UNAVAILABLE',
    };
  }

  if (amlRaw?.isError) {
    const cached = extractCachedAmlMapped(customer.kycData);
    if (shouldAutoApproveFromAmlStatus(cached)) {
      return { allowed: true, mapped: cached, clientNumber, fallback: 'cached_aml' };
    }

    const localAllow = allowFromLocal(customer, 'local_approval_aml_error');
    if (localAllow) return { ...localAllow, clientNumber };

    return {
      allowed: false,
      message:
        amlRaw.message ||
        'AML verification failed. Complete compliance review before sending money.',
      code: 'AML_NOT_ONBOARDED',
    };
  }

  const mapped = mapAmlCustomerStatus(amlRaw);
  const statusId = Number(mapped.statusId);

  if (AML_BLOCKED_STATUS_IDS.has(statusId) || mapped.isBlocked) {
    return {
      allowed: false,
      message:
        'Your account is blocked by compliance review. Contact support for assistance.',
      code: 'AML_CUSTOMER_BLOCKED',
      mapped,
    };
  }

  if (Number.isFinite(statusId) && statusId >= 1) {
    return { allowed: true, mapped, clientNumber };
  }

  // Live AML still pending (e.g. iSTR Pending) — honor local LiveEx / admin approval
  // so the app "Verified · full limits" state matches send eligibility.
  const localAllow = allowFromLocal(customer, 'local_approval_aml_pending');
  if (localAllow) return { ...localAllow, mapped, clientNumber };

  return {
    allowed: false,
    message: `AML verification required. Your status is "${mapped.statusLabel || 'Pending'}". You cannot send money until compliance clears.`,
    code: 'AML_NOT_ONBOARDED',
    mapped,
  };
}
