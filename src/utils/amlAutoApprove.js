import prisma from './prisma.js';
import { emitCustomersUpdated } from './portalNotify.js';
import {
  resolveAmlClientNumber,
  amlGetCustomerStatus,
  mapAmlCustomerStatus,
} from '../services/amlProvider.service.js';
import {
  parseOnBoardStatusId,
  shouldAutoApproveFromLiveex,
  shouldRejectFromLiveex,
  isOnboardPendingReview,
  LIVEEX_ONBOARD_STATUS,
} from './liveexOnboardStatus.js';

function extractDigitalOnboardingFromKyc(kycData) {
  const entries = Array.isArray(kycData)
    ? kycData
    : kycData && typeof kycData === 'object'
      ? [kycData]
      : [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]?.digitalOnboarding) return entries[i].digitalOnboarding;
  }
  if (kycData && typeof kycData === 'object' && !Array.isArray(kycData) && kycData.paths) {
    return kycData;
  }
  return null;
}

/** LiveEx CIP started but not Completed — blocks AML auto-approve. */
export function isLiveexCipBlockingAmlApprove(digitalOnboarding) {
  if (!digitalOnboarding?.rowIdGid) return false;
  const id = parseOnBoardStatusId(digitalOnboarding);
  if (id === LIVEEX_ONBOARD_STATUS.COMPLETED) return false;
  return true;
}

/** Blocked / rejected AML statuses — never auto-approve. */
export const AML_BLOCKED_STATUS_IDS = new Set([7, 8, 9]);

/**
 * Portal/registration rule for TMS AML customer status:
 * - Only Onboarded (6) / confirmed labels → approve
 * - Pending compliance / case / frozen / blocked → stay pending
 * LiveEx Digital Onboarding Completed is still required when CIP was started.
 */
export function shouldAutoApproveFromAmlStatus(mapped) {
  if (!mapped) return false;

  const statusId = Number(mapped.statusId);
  const hasStatusId = Number.isFinite(statusId);
  const label = String(mapped.statusLabel || mapped.customerStatus || '').toLowerCase();

  if (mapped.isBlocked) return false;
  if (mapped.isFrozen) return false;
  if (hasStatusId && AML_BLOCKED_STATUS_IDS.has(statusId)) return false;
  if (/\b(blocked|disabled|reject(ed)?)\b/.test(label)) return false;
  if (/\b(pending|case|sar|validate|hold|frozen)\b/.test(label)) return false;

  // Only fully onboarded TMS status
  if (mapped.isOnboarded === true || statusId === 6) return true;

  if (
    /\b(confirmed|onboarded|cleared|approved|active)\b/.test(label) &&
    !/\b(pending|case|sar|validate)\b/.test(label)
  ) {
    return true;
  }

  return false;
}

/** Mark KYC document entries rejected when LiveEx onboard decision is Rejected. */
export function rejectKycDocumentsInData(kycData) {
  const now = new Date().toISOString();
  const markDoc = (doc) => {
    if (!doc || typeof doc !== 'object') return doc;
    return {
      ...doc,
      status: 'rejected',
      rejectedAt: doc.rejectedAt || now,
      rejectedBy: doc.rejectedBy || 'liveex-auto',
    };
  };

  if (Array.isArray(kycData)) return kycData.map(markDoc);
  if (kycData && typeof kycData === 'object') return markDoc(kycData);
  return kycData;
}

/** Reset KYC docs to pending when LiveEx onboard is Pending / In Review. */
export function setKycDocumentsPendingInData(kycData) {
  const markDoc = (doc) => {
    if (!doc || typeof doc !== 'object') return doc;
    const status = String(doc.status || '').toLowerCase();
    if (status === 'rejected') return doc;
    return { ...doc, status: 'pending' };
  };

  if (Array.isArray(kycData)) return kycData.map(markDoc);
  if (kycData && typeof kycData === 'object') return markDoc(kycData);
  return kycData;
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
  // LiveEx CIP incomplete (pending / in review / not submitted / rejected)
  // wins — do not approve from AML alone (avoids app VERIFIED then Pending).
  const liveexDig = extractDigitalOnboardingFromKyc(kycData);
  if (isLiveexCipBlockingAmlApprove(liveexDig) || isOnboardPendingReview(liveexDig)) {
    console.log(
      `[AML] Skip auto-approve for ${customer.id}: LiveEx CIP incomplete ` +
        `(onBoardStatusId=${parseOnBoardStatusId(liveexDig)}, ` +
        `rowId=${liveexDig?.rowIdGid || 'n/a'})`,
    );
    return {
      customerApproved: false,
      customerStatus: customer.status,
      kycData,
      newlyApproved: false,
      blockedByLiveexPending: true,
    };
  }

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

/** Normalize LiveEx face score (0–1 or 0–100) to percent. */
export function toFaceMatchPercent(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? n * 100 : n;
}

/** Collect status strings LiveEx may put on different fields. */
function collectLiveexStatusLabels(digitalOnboarding) {
  const dig = digitalOnboarding || {};
  return [
    dig.statusLabel,
    dig.onBoardStatus,
    dig.status,
    dig.lastDetailsResponse?.status,
    dig.lastDetailsResponse?.onBoardStatus,
    dig.lastSubmitKycResponse?.status,
    dig.lastSubmitKycResponse?.onBoardStatus,
  ]
    .map((v) => String(v || '').toLowerCase().trim())
    .filter(Boolean);
}

/** True when any KYC entry is LiveEx Completed (onBoardStatusId = 3). */
export function kycDataSatisfiesVerification(kycData) {
  let raw = kycData;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  const docs = raw ? (Array.isArray(raw) ? raw : [raw]) : [];

  // If LiveEx CIP was used, only Completed counts (ignore stale doc.status=approved).
  for (let i = docs.length - 1; i >= 0; i -= 1) {
    const dig = docs[i]?.digitalOnboarding || (docs[i]?.paths ? docs[i] : null);
    if (dig?.rowIdGid) {
      return parseOnBoardStatusId(dig) === 3;
    }
  }

  return docs.some((doc) => {
    if (!doc || typeof doc !== 'object') return false;
    const dig = doc.digitalOnboarding || (doc.paths ? doc : null);
    const onboardId = parseOnBoardStatusId(dig);
    if (onboardId != null) {
      return onboardId === 3;
    }
    const status = String(doc.status || '').toLowerCase();
    return status === 'approved';
  });
}

function kycDocsNeedExplicitApprovedStatus(kycData) {
  let raw = kycData;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return true;
    }
  }
  const docs = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  return !docs.some(
    (doc) => doc && String(doc.status || '').toLowerCase() === 'approved',
  );
}

/**
 * If LiveEx onboard decision is Rejected (4), set customer.status=rejected.
 */
export async function maybeRejectCustomerFromLiveex(
  customer,
  kycData,
  digitalOnboarding,
  req,
  rejectedBy = 'liveex-auto',
) {
  if (!shouldRejectFromLiveex(digitalOnboarding)) {
    return {
      customerApproved: false,
      customerRejected: false,
      customerStatus: customer.status,
      kycData,
      newlyRejected: false,
    };
  }

  const nextKyc = rejectKycDocumentsInData(kycData);
  const alreadyRejected = String(customer.status || '').toLowerCase() === 'rejected';
  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      kycData: nextKyc,
      status: 'rejected',
    },
  });

  if (!alreadyRejected) {
    console.log(
      `[LiveEx] Rejected customer ${customer.id} (onBoardStatusId=${digitalOnboarding?.onBoardStatusId}, by=${rejectedBy})`,
    );
    emitCustomersUpdated(req);
  }

  return {
    customerApproved: false,
    customerRejected: true,
    customerStatus: updated.status,
    kycData: nextKyc,
    newlyRejected: !alreadyRejected,
  };
}

/**
 * If LiveEx onboard is Pending / In Review (1–2), keep customer pending.
 */
export async function maybeSetCustomerPendingFromLiveex(
  customer,
  kycData,
  digitalOnboarding,
  req,
  source = 'liveex-auto',
) {
  if (!isOnboardPendingReview(digitalOnboarding)) {
    return {
      customerApproved: false,
      customerRejected: false,
      customerStatus: customer.status,
      kycData,
      newlyPending: false,
    };
  }

  const nextKyc = setKycDocumentsPendingInData(kycData);
  const currentStatus = String(customer.status || '').toLowerCase();
  const needsStatusDowngrade = currentStatus === 'approved';
  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      kycData: nextKyc,
      ...(needsStatusDowngrade ? { status: 'pending' } : {}),
    },
  });

  if (needsStatusDowngrade) {
    console.log(
      `[LiveEx] Set customer ${customer.id} pending (onBoardStatusId=${digitalOnboarding?.onBoardStatusId}, by=${source})`,
    );
    emitCustomersUpdated(req);
  }

  return {
    customerApproved: false,
    customerRejected: false,
    customerStatus: updated.status,
    kycData: nextKyc,
    newlyPending: needsStatusDowngrade,
  };
}

/**
 * Sync customer.status + KYC docs from LiveEx onBoardStatusId (1–4).
 */
export async function syncCustomerStatusFromLiveexOnboard(
  customer,
  kycData,
  digitalOnboarding,
  req,
  source = 'liveex-sync',
) {
  const onboardId = parseOnBoardStatusId(digitalOnboarding);
  if (onboardId == null) {
    return {
      customerApproved: false,
      customerRejected: false,
      customerStatus: customer.status,
      kycData,
      onboardStatusId: null,
      newlyApproved: false,
      newlyRejected: false,
      newlyPending: false,
    };
  }

  if (onboardId === 3) {
    const result = await maybeAutoApproveCustomerFromLiveex(
      customer,
      kycData,
      digitalOnboarding,
      req,
      source,
    );
    return { ...result, customerRejected: false, onboardStatusId: onboardId, newlyPending: false };
  }

  if (onboardId === 4) {
    const result = await maybeRejectCustomerFromLiveex(
      customer,
      kycData,
      digitalOnboarding,
      req,
      source,
    );
    return {
      ...result,
      customerApproved: false,
      onboardStatusId: onboardId,
      newlyApproved: false,
      newlyPending: false,
    };
  }

  const result = await maybeSetCustomerPendingFromLiveex(
    customer,
    kycData,
    digitalOnboarding,
    req,
    source,
  );
  return {
    ...result,
    customerApproved: false,
    customerRejected: false,
    onboardStatusId: onboardId,
    newlyApproved: false,
    newlyRejected: false,
  };
}

/**
 * If LiveEx CIP status qualifies, set customer.status=approved.
 */
export async function maybeAutoApproveCustomerFromLiveex(
  customer,
  kycData,
  digitalOnboarding,
  req,
  approvedBy = 'liveex-auto',
) {
  if (!shouldAutoApproveFromLiveex(digitalOnboarding)) {
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
      `[LiveEx] Auto-approved customer ${customer.id} (onBoardStatusId=${digitalOnboarding?.onBoardStatusId}, statusId=${digitalOnboarding?.statusId}, statusLabel=${digitalOnboarding?.statusLabel}, by=${approvedBy})`,
    );
    emitCustomersUpdated(req);
  } else if (kycDocsNeedExplicitApprovedStatus(kycData)) {
    console.log(
      `[LiveEx] Backfilled KYC approved docs for customer ${customer.id} (by=${approvedBy})`,
    );
  }

  return {
    customerApproved: true,
    customerStatus: updated.status,
    kycData: nextKyc,
    newlyApproved: !alreadyApproved,
  };
}

/**
 * Approve from cached LiveEx / AML status in kycData (no remote call).
 * Also backfills KYC doc status when docs+face match / Completed qualify,
 * even if customer.status is already approved.
 */
export async function tryApprovePendingCustomerFromCachedStatus(customer, req = null) {
  if (!customer?.id) {
    return { customerApproved: false, newlyApproved: false };
  }
  if (String(customer.status || '').toLowerCase() === 'rejected') {
    return {
      customerApproved: false,
      newlyApproved: false,
      customerStatus: customer.status,
    };
  }

  const dig = (() => {
    const raw = customer.kycData;
    const entries = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? [raw]
        : [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i]?.digitalOnboarding) return entries[i].digitalOnboarding;
    }
    // cached liveex payload sometimes stored as the root object
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.paths) {
      return raw;
    }
    return null;
  })();

  const alreadyApproved = String(customer.status || '').toLowerCase() === 'approved';
  const needsDocFix = kycDocsNeedExplicitApprovedStatus(customer.kycData);

  if (dig && parseOnBoardStatusId(dig) != null) {
    return syncCustomerStatusFromLiveexOnboard(
      customer,
      customer.kycData,
      dig,
      req,
      'liveex-cache-auto',
    );
  }

  if (shouldAutoApproveFromLiveex(dig) && (!alreadyApproved || needsDocFix)) {
    return maybeAutoApproveCustomerFromLiveex(
      customer,
      customer.kycData,
      dig,
      req,
      'liveex-cache-auto',
    );
  }

  const amlMapped = (() => {
    const raw = customer.kycData;
    const entries = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? [raw]
        : [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const aml = entries[i]?.aml;
      if (aml?.mapped) return aml.mapped;
      if (aml && (aml.statusId != null || aml.statusLabel)) {
        return {
          statusId: aml.statusId,
          statusLabel: aml.statusLabel || aml.customerStatus,
          isBlocked: aml.isBlocked,
        };
      }
    }
    return null;
  })();

  if (shouldAutoApproveFromAmlStatus(amlMapped) && (!alreadyApproved || needsDocFix)) {
    return maybeAutoApproveCustomerFromAml(
      customer,
      customer.kycData,
      amlMapped,
      req,
      'aml-cache-auto',
    );
  }

  if (alreadyApproved) {
    return {
      customerApproved: true,
      newlyApproved: false,
      customerStatus: customer.status,
    };
  }

  return {
    customerApproved: false,
    newlyApproved: false,
    customerStatus: customer.status,
  };
}
