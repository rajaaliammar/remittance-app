import prisma from './prisma.js';
import { emitCustomersUpdated } from './portalNotify.js';
import {
  resolveAmlClientNumber,
  amlGetCustomerStatus,
  mapAmlCustomerStatus,
} from '../services/amlProvider.service.js';

/** Blocked / rejected AML statuses — never auto-approve. */
export const AML_BLOCKED_STATUS_IDS = new Set([7, 8, 9]);

/**
 * Portal/registration rule:
 * - statusId >= 1 (and not blocked 7/8/9) → approve
 * - status label confirmed / onboarded / cleared → approve
 * - statusId 0 / null / incomplete / blocked → leave pending
 */
export function shouldAutoApproveFromAmlStatus(mapped) {
  if (!mapped) return false;

  const statusId = Number(mapped.statusId);
  const hasStatusId = Number.isFinite(statusId);
  const label = String(mapped.statusLabel || mapped.customerStatus || '').toLowerCase();

  // Blocked / rejected never auto-approve
  if (mapped.isBlocked) return false;
  if (hasStatusId && AML_BLOCKED_STATUS_IDS.has(statusId)) return false;
  if (/\b(blocked|disabled|reject(ed)?)\b/.test(label)) return false;

  // Explicit confirmed / onboarded / cleared labels
  if (
    /\b(confirmed|onboarded|cleared|approved|active)\b/.test(label)
  ) {
    return true;
  }

  // statusId >= 1 wins even if provider sets isError quirks
  if (hasStatusId && statusId >= 1) return true;

  // statusId 0 / missing / error-only responses stay pending
  return false;
}

/** Mark KYC document entries approved so remittance KYC checks pass. */
export function approveKycDocumentsInData(kycData) {
  const now = new Date().toISOString();
  const markDoc = (doc) => {
    if (!doc || typeof doc !== 'object') return doc;
    const next = { ...doc };
    const status = String(next.status || '').toLowerCase();
    if (status !== 'approved' && status !== 'rejected') {
      next.status = 'approved';
      next.approvedAt = next.approvedAt || now;
      next.approvedBy = next.approvedBy || 'aml-auto';
    }
    if (Array.isArray(next.documents)) {
      next.documents = next.documents.map((field) => {
        if (!field || typeof field !== 'object') return field;
        const fs = String(field.status || '').toLowerCase();
        if (fs === 'approved' || fs === 'rejected') return field;
        return {
          ...field,
          status: 'approved',
          approvedAt: field.approvedAt || now,
        };
      });
    }
    return next;
  };

  if (Array.isArray(kycData)) return kycData.map(markDoc);
  if (kycData && typeof kycData === 'object') return markDoc(kycData);
  return kycData;
}

/**
 * If AML status qualifies, set customer.status=approved and approve KYC docs.
 */
export async function maybeAutoApproveCustomerFromAml(
  customer,
  kycData,
  mapped,
  req,
  approvedBy = 'aml-auto',
) {
  if (!shouldAutoApproveFromAmlStatus(mapped)) {
    return {
      customerApproved: false,
      customerStatus: customer.status,
      kycData,
      newlyApproved: false,
    };
  }

  const nextKyc = approveKycDocumentsInData(kycData);
  const alreadyApproved = String(customer.status || '').toLowerCase() === 'approved';
  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      kycData: nextKyc,
      ...(alreadyApproved
        ? {}
        : {
            status: 'approved',
            approvedAt: customer.approvedAt || new Date(),
            approvedBy: customer.approvedBy || approvedBy,
          }),
    },
  });

  if (!alreadyApproved) {
    console.log(
      `[AML] Auto-approved customer ${customer.id} (AML statusId=${mapped.statusId}, by=${approvedBy})`,
    );
    emitCustomersUpdated(req);
  }

  return {
    customerApproved: true,
    customerStatus: updated.status,
    kycData: nextKyc,
    newlyApproved: !alreadyApproved,
  };
}

/**
 * After registration AML onboard/docs: fetch live AML status and auto-approve
 * when statusId >= 1. Leaves status 0 / incomplete / error as pending.
 */
export async function finalizeRegistrationAmlApproval(customerId, req) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return {
      customerApproved: false,
      newlyApproved: false,
      customerStatus: null,
      mapped: null,
    };
  }

  const clientNumber = resolveAmlClientNumber(customer);
  let amlRaw = null;
  let mapped = { statusId: 0, statusLabel: 'Unknown', isError: true };

  try {
    amlRaw = await amlGetCustomerStatus(clientNumber);
    mapped = mapAmlCustomerStatus(amlRaw);
  } catch (err) {
    console.warn(
      `[AML] finalizeRegistrationAmlApproval status fetch failed for ${customerId}:`,
      err.message,
    );
    return {
      customerApproved: false,
      newlyApproved: false,
      customerStatus: customer.status,
      mapped,
      error: err.message,
    };
  }

  // Persist latest status into kycData (without approving yet)
  const kycDataBase =
    customer.kycData && typeof customer.kycData === 'object'
      ? customer.kycData
      : {};
  let nextKyc;
  if (Array.isArray(kycDataBase)) {
    nextKyc = kycDataBase.map((entry, i) => {
      if (i !== kycDataBase.length - 1) return entry;
      return {
        ...entry,
        aml: {
          ...(entry.aml || {}),
          mapped,
          ...(mapped || {}),
          clientNumber,
          lastStatusResponse: amlRaw,
          syncedAt: new Date().toISOString(),
        },
      };
    });
  } else {
    nextKyc = {
      ...kycDataBase,
      amlClientNumber: clientNumber,
      aml: {
        ...(kycDataBase.aml || {}),
        mapped,
        ...(mapped || {}),
        clientNumber,
        lastStatusResponse: amlRaw,
        syncedAt: new Date().toISOString(),
      },
    };
  }

  const result = await maybeAutoApproveCustomerFromAml(
    customer,
    nextKyc,
    mapped,
    req,
    'aml-registration-auto',
  );

  // If not approved, still save status cache
  if (!result.customerApproved) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { kycData: nextKyc },
    });
  }

  return {
    ...result,
    mapped,
    clientNumber,
    aml: amlRaw,
  };
}
