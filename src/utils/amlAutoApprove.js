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

/**
 * Docs uploaded + face matched (not failed) → treat as approved.
 * Covers payloads like /liveex/cached with nameFront/nameSelfie + faceMatchScore.
 */
export function hasSuccessfulFaceMatchAndDocs(digitalOnboarding) {
  if (!digitalOnboarding || typeof digitalOnboarding !== 'object') return false;
  if (digitalOnboarding.faceMatchFailed === true) return false;

  const onBoardStatusId = Number(digitalOnboarding.onBoardStatusId);
  if (Number.isFinite(onBoardStatusId) && onBoardStatusId === 4) return false;

  const labels = collectLiveexStatusLabels(digitalOnboarding);
  if (labels.some((l) => /\b(blocked|disabled|reject(ed)?)\b/.test(l))) {
    return false;
  }

  const paths =
    digitalOnboarding.paths && typeof digitalOnboarding.paths === 'object'
      ? digitalOnboarding.paths
      : {};
  const hasFront = !!(
    paths.nameFront ||
    paths.idFront ||
    paths.front ||
    paths['id-front']
  );
  const hasSelfie = !!(
    paths.nameSelfie ||
    paths.selfie ||
    paths['id-selfie']
  );
  const temp = digitalOnboarding.lastTempDocumentResponses || {};
  const hasTempDocs = !!(temp.id_front || temp.selfie || temp.id_back);
  const hasDocs =
    (hasFront && hasSelfie) ||
    hasTempDocs ||
    !!digitalOnboarding.identityUploadedAt ||
    !!digitalOnboarding.submittedAt ||
    !!digitalOnboarding.lastSubmitKycResponse;

  if (!hasDocs) return false;

  const scores = [
    digitalOnboarding.faceMatchScore,
    digitalOnboarding.faceMatchConfidence,
    digitalOnboarding.matchConfidence,
    temp.selfie?.score,
    temp.selfie?.confidence,
  ];
  for (const s of scores) {
    const pct = toFaceMatchPercent(s);
    if (pct != null && pct > 0) return true;
  }

  // LiveEx pipeline marked Completed / submitted without faceMatchFailed
  if (labels.some((l) => /\bcompleted\b/.test(l))) return true;
  return !!(
    digitalOnboarding.submittedAt ||
    digitalOnboarding.lastSubmitKycResponse
  );
}

/** True when any KYC entry is approved or has LiveEx docs + face match / Completed. */
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
  return docs.some((doc) => {
    if (!doc || typeof doc !== 'object') return false;
    const status = String(doc.status || '').toLowerCase();
    if (status === 'approved') return true;
    if (status === 'rejected') return false;
    const dig = doc.digitalOnboarding || (doc.paths ? doc : null);
    return shouldAutoApproveFromLiveex(dig);
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
 * LiveEx Digital Onboarding auto-approve:
 * - statusLabel / details status "Completed" → approve (even if onBoardStatus is still "Profile in Review")
 * - statusId >= 1 and not blocked → approve
 * - onBoardStatusId >= 1 and not 4 → approve
 * - Docs uploaded + face matched → approve
 * - Face/ID submitted → approve
 */
export function shouldAutoApproveFromLiveex(digitalOnboarding) {
  if (!digitalOnboarding || typeof digitalOnboarding !== 'object') return false;

  const onBoardStatusId = Number(digitalOnboarding.onBoardStatusId);
  const statusId = Number(digitalOnboarding.statusId);
  const hasOnBoard = Number.isFinite(onBoardStatusId);
  const hasStatus = Number.isFinite(statusId);

  if (hasOnBoard && onBoardStatusId === 4) return false;
  if (hasStatus && AML_BLOCKED_STATUS_IDS.has(statusId)) return false;

  const labels = collectLiveexStatusLabels(digitalOnboarding);
  if (labels.some((l) => /\b(blocked|disabled|reject(ed)?)\b/.test(l))) {
    return false;
  }

  // IMPORTANT: check statusLabel / nested status "Completed", not only onBoardStatus
  // (onBoardStatus can stay "Profile in Review" while pipeline status is Completed)
  if (
    labels.some((l) =>
      /\b(completed|onboard success|onboarded|cleared|approved|confirmed)\b/.test(l),
    )
  ) {
    return true;
  }

  if (hasStatus && statusId >= 1) return true;
  if (hasOnBoard && onBoardStatusId >= 1) return true;

  if (
    digitalOnboarding.submittedAt ||
    digitalOnboarding.clientNumber ||
    digitalOnboarding.lastSubmitKycResponse
  ) {
    return true;
  }

  if (hasSuccessfulFaceMatchAndDocs(digitalOnboarding)) return true;

  return false;
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
