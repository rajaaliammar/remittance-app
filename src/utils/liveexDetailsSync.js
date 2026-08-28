/**
 * Poll LiveEx Digital Onboarding /customer/details and sync customer.status.
 * Used after face match and when the mobile app loads verifications
 * (so status updates without requiring a portal refresh).
 */

import prisma from './prisma.js';
import { liveexCustomerDetails } from '../services/liveexDigitalOnboarding.service.js';
import {
  extractDigitalOnboarding,
  mergeDigitalOnboarding,
} from '../services/liveexOnboarding.builder.js';
import { syncCustomerStatusFromLiveexOnboard } from './amlAutoApprove.js';
import {
  LIVEEX_ONBOARD_STATUS,
  parseOnBoardStatusId,
} from './liveexOnboardStatus.js';

const LIVEEX_PIPELINE_TERMINAL = new Set([6, 7, 8, 9]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isLiveexDecisionSettled(digitalOnboarding) {
  const onboardId = parseOnBoardStatusId(digitalOnboarding);
  if (
    onboardId === LIVEEX_ONBOARD_STATUS.COMPLETED ||
    onboardId === LIVEEX_ONBOARD_STATUS.REJECTED
  ) {
    return true;
  }
  const statusId = Number(digitalOnboarding?.statusId);
  return Number.isFinite(statusId) && LIVEEX_PIPELINE_TERMINAL.has(statusId);
}

/** LiveEx CIP started but not Completed — must not treat customer as verified. */
export function isLiveexCipIncomplete(digitalOnboarding) {
  if (!digitalOnboarding?.rowIdGid) return false;
  const id = parseOnBoardStatusId(digitalOnboarding);
  if (id === LIVEEX_ONBOARD_STATUS.COMPLETED) return false;
  return true; // pending, in review, rejected, or not submitted yet
}

export async function fetchStoreAndSyncLiveexDetails(
  customer,
  { rowIdGid, email, req, source = 'liveex-details-auto' } = {},
) {
  const raw = await liveexCustomerDetails({ rowIdGid, email });
  const dig = extractDigitalOnboarding(customer);
  const kycData = mergeDigitalOnboarding(customer, {
    rowIdGid,
    email,
    statusId: raw?.statusId ?? dig?.statusId ?? null,
    statusLabel: raw?.status || dig?.statusLabel || null,
    onBoardStatusId:
      raw?.onBoardStatusId != null
        ? raw.onBoardStatusId
        : dig?.onBoardStatusId ?? null,
    onBoardStatus:
      raw?.onBoardStatus != null && String(raw.onBoardStatus).trim() !== ''
        ? raw.onBoardStatus
        : dig?.onBoardStatus ?? null,
    matchConfidence: raw?.matchConfidence ?? dig?.matchConfidence ?? null,
    clientNumber: raw?.clientNumber || dig?.clientNumber || null,
    idNumber: raw?.idNumber || dig?.idNumber || null,
    lastDetailsResponse: raw,
    detailsPolledAt: new Date().toISOString(),
  });
  await prisma.customer.update({
    where: { id: customer.id },
    data: { kycData },
  });
  const digCached = extractDigitalOnboarding({ kycData });
  const approval = await syncCustomerStatusFromLiveexOnboard(
    { ...customer, kycData },
    kycData,
    digCached,
    req,
    source,
  );

  let nextCustomer = {
    ...customer,
    kycData: approval.kycData || kycData,
    status: approval.customerStatus ?? customer.status,
  };
  if (
    approval.newlyApproved ||
    approval.newlyPending ||
    approval.newlyRejected
  ) {
    nextCustomer =
      (await prisma.customer.findUnique({ where: { id: customer.id } })) ||
      nextCustomer;
  }

  return { customer: nextCustomer, raw, digCached, approval };
}

export async function pollLiveexDetailsRapidly(
  customer,
  {
    rowIdGid,
    email,
    req,
    source = 'liveex-poll-auto',
    maxAttempts = 8,
    intervalMs = 1200,
  } = {},
) {
  const attempts = Math.min(20, Math.max(1, Number(maxAttempts) || 8));
  const delay = Math.min(5000, Math.max(300, Number(intervalMs) || 1200));
  let last = null;
  let current = customer;

  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(delay);
    try {
      last = await fetchStoreAndSyncLiveexDetails(current, {
        rowIdGid,
        email,
        req,
        source: `${source}#${i + 1}`,
      });
      current = last.customer;
      const onboardId = parseOnBoardStatusId(last.digCached);
      console.log(
        `[LiveEx-Onboard] details poll ${i + 1}/${attempts} for ${customer.id}: ` +
          `onBoardStatusId=${onboardId}, statusId=${last.digCached?.statusId}`,
      );
      if (isLiveexDecisionSettled(last.digCached)) {
        console.log(
          `[LiveEx-Onboard] details settled after ${i + 1} poll(s) for ${customer.id}`,
        );
        break;
      }
    } catch (err) {
      console.warn(
        `[LiveEx-Onboard] details poll ${i + 1}/${attempts} failed for ${customer.id}:`,
        err.message,
      );
      if (i === attempts - 1 && !last) throw err;
    }
  }

  return last;
}

/**
 * Mobile app self-check: if LiveEx CIP is incomplete, pull live status from
 * LiveEx and sync customer.status (no portal action required).
 */
export async function syncLiveexStatusIfNeeded(customer, req = null, options = {}) {
  if (!customer?.id) return { customer, synced: false };
  const dig = extractDigitalOnboarding(customer);
  if (!dig?.rowIdGid) return { customer, synced: false };

  if (!isLiveexCipIncomplete(dig) && options.force !== true) {
    return { customer, synced: false, digCached: dig };
  }

  const email = dig.email || customer.email;
  if (!email) return { customer, synced: false };

  try {
    const polled = await pollLiveexDetailsRapidly(customer, {
      rowIdGid: dig.rowIdGid,
      email,
      req,
      source: options.source || 'liveex-app-self-check',
      maxAttempts: options.maxAttempts ?? 4,
      intervalMs: options.intervalMs ?? 800,
    });
    let next = polled?.customer || customer;
    const digCached = polled?.digCached || dig;

    // Still incomplete after poll but customer marked approved (stale aml-auto) → pending
    if (
      isLiveexCipIncomplete(digCached) &&
      String(next.status || '').toLowerCase() === 'approved'
    ) {
      const forced = await syncCustomerStatusFromLiveexOnboard(
        next,
        next.kycData,
        {
          ...digCached,
          onBoardStatusId:
            parseOnBoardStatusId(digCached) ??
            LIVEEX_ONBOARD_STATUS.PROFILE_PENDING,
          onBoardStatus: digCached.onBoardStatus || 'Pending',
        },
        req,
        'liveex-incomplete-guard',
      );
      if (forced?.kycData || forced?.newlyPending) {
        next =
          (await prisma.customer.findUnique({ where: { id: customer.id } })) ||
          next;
      }
    }

    return {
      customer: next,
      synced: true,
      digCached: extractDigitalOnboarding(next) || digCached,
      approval: polled?.approval,
      pollsSettled: isLiveexDecisionSettled(
        extractDigitalOnboarding(next) || digCached,
      ),
    };
  } catch (err) {
    console.warn(
      `[LiveEx-Onboard] app self-check failed for ${customer.id}:`,
      err.message,
    );
    return { customer, synced: false, error: err.message };
  }
}
