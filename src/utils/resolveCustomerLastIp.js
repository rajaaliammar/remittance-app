import { isUsableClientIp, normalizeClientIp } from './clientIp.js';
import { findAmlKycEntry } from './amlKycData.js';

export function pickIpFromAmlPayload(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  const keys = [
    'registrationIp',
    'csIPAddress',
    'csIpAddress',
    'IPAddress',
    'ipAddress',
    'lastIpAddress',
  ];
  for (const key of keys) {
    const val = obj[key];
    if (isUsableClientIp(val)) return normalizeClientIp(val);
  }
  if (obj.obj_CS_N && typeof obj.obj_CS_N === 'object') {
    return pickIpFromAmlPayload(obj.obj_CS_N, depth + 1);
  }
  return null;
}

/** @deprecated alias */
export const pickIpFromObject = pickIpFromAmlPayload;

function pickIpFromKycData(kycData) {
  const entry = findAmlKycEntry(kycData);
  if (!entry?.aml || typeof entry.aml !== 'object') return null;

  const aml = entry.aml;
  if (isUsableClientIp(aml.registrationIp)) {
    return normalizeClientIp(aml.registrationIp);
  }
  return (
    pickIpFromAmlPayload(aml.lastSaveResponse) ||
    pickIpFromAmlPayload(aml.lastStatusResponse) ||
    null
  );
}

/**
 * Resolve client IP for API responses (portal AML card).
 * @param {object} customer
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {unknown[]} [extraSources] — AML status / exists payloads
 */
export async function resolveLastIpForApi(customer, prisma, extraSources = []) {
  let ip = await resolveCustomerLastIpAddress(customer, prisma);
  if (!ip && Array.isArray(extraSources)) {
    for (const src of extraSources) {
      ip = pickIpFromAmlPayload(src);
      if (ip) break;
    }
  }
  if (ip) {
    await backfillCustomerLastIpIfMissing(customer, prisma, ip);
  }
  return ip;
}

/** Shape included on customer + AML endpoints for the portal. */
export function buildClientIpFields(ip) {
  const lastIpAddress = ip || null;
  return {
    lastIpAddress,
    clientIp: lastIpAddress,
  };
}

/**
 * Resolve the best known client IP for portal AML display.
 * Order: customers.lastIpAddress → AML cache → latest remittance transaction.
 */
export async function resolveCustomerLastIpAddress(customer, prisma) {
  if (!customer?.id) return null;

  if (isUsableClientIp(customer.lastIpAddress)) {
    return normalizeClientIp(customer.lastIpAddress);
  }

  const fromKyc = pickIpFromKycData(customer.kycData);
  if (fromKyc) return fromKyc;

  try {
    const txs = await prisma.remittanceTransaction.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { ipAddress: true },
    });
    for (const tx of txs) {
      if (isUsableClientIp(tx?.ipAddress)) {
        return normalizeClientIp(tx.ipAddress);
      }
    }
  } catch (err) {
    console.warn('[resolveCustomerLastIp] transaction lookup failed:', err?.message);
  }

  return null;
}

/** Persist resolved IP on the customer row when we found it elsewhere. */
export async function backfillCustomerLastIpIfMissing(customer, prisma, resolvedIp) {
  if (!customer?.id || !isUsableClientIp(resolvedIp)) return;
  if (isUsableClientIp(customer.lastIpAddress)) return;
  try {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { lastIpAddress: normalizeClientIp(resolvedIp) },
    });
  } catch (err) {
    console.warn('[resolveCustomerLastIp] backfill failed:', err?.message);
  }
}
