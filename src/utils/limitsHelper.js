import prisma from './prisma.js';
import {
  expandKycCountryTokens,
  kycFormMatchesCountryTokens,
} from './kycCountryTokens.js';

/** Start of today UTC */
export function startOfDayUTC(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/** Start of week (Monday) UTC */
export function startOfWeekUTC(d) {
  const x = new Date(d);
  const day = x.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(x);
  monday.setUTCDate(x.getUTCDate() + mondayOffset);
  return new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
}

/** Start of month UTC */
export function startOfMonthUTC(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1));
}

function toLimitNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function maxLimit(current, next) {
  if (next == null) return current;
  if (current == null) return next;
  return Math.max(current, next);
}

/** Aggregate limits from every transaction type row on a level. */
function limitsFromLevelRow(level) {
  if (
    !level?.transactionLimits ||
    !Array.isArray(level.transactionLimits) ||
    level.transactionLimits.length === 0
  ) {
    return null;
  }

  let daily = null;
  let weekly = null;
  let monthly = null;
  let currency = 'USD';

  for (const row of level.transactionLimits) {
    if (!row || typeof row !== 'object') continue;
    daily = maxLimit(daily, toLimitNumber(row.dailyAmount));
    weekly = maxLimit(weekly, toLimitNumber(row.weeklyAmount));
    monthly = maxLimit(
      monthly,
      toLimitNumber(row.monthlyAmount ?? row.maxBalance)
    );
    const perTx = toLimitNumber(row.perTransaction);
    if (monthly == null && perTx != null) {
      monthly = maxLimit(monthly, perTx);
    }
    if (row.currency) currency = String(row.currency);
  }

  if (daily == null && weekly == null && monthly == null) return null;

  return {
    daily,
    weekly,
    monthly,
    currency,
    levelId: level.id,
    levelName: level.name,
    levelPriority: level.priority != null ? Number(level.priority) : null,
  };
}

/**
 * Shape tier + KYC caps for mobile (never return all-null amounts when KYC caps exist).
 */
export function buildTierLimitsForApp({
  limits,
  nextLevel,
  kycMaxTransactionAmount,
  minimumKycMaxAmount,
}) {
  const currency =
    limits?.currency ?? nextLevel?.currency ?? 'USD';
  let daily = limits?.daily ?? null;
  let weekly = limits?.weekly ?? null;
  let monthly = limits?.monthly ?? null;
  let levelId = limits?.levelId ?? null;
  let levelName = limits?.levelName ?? null;
  let levelPriority = limits?.levelPriority ?? null;

  const kycCap =
    kycMaxTransactionAmount != null
      ? Number(kycMaxTransactionAmount)
      : minimumKycMaxAmount != null
        ? Number(minimumKycMaxAmount)
        : null;

  if (monthly == null && weekly == null && daily == null && kycCap != null) {
    monthly = kycCap;
    if (!levelName) levelName = 'Verified';
    if (levelPriority == null) levelPriority = 0;
  }

  return {
    levelId,
    levelName,
    levelPriority,
    daily,
    weekly,
    monthly,
    currency,
    kycMaxTransactionAmount:
      kycMaxTransactionAmount != null
        ? Number(kycMaxTransactionAmount)
        : null,
    minimumKycMaxAmount:
      minimumKycMaxAmount != null ? Number(minimumKycMaxAmount) : null,
    nextLevel: nextLevel ?? null,
  };
}

/**
 * Pick the default level for a newly verified customer (second-lowest active tier when available).
 */
export async function resolveDefaultVerifiedLevel() {
  const levels = await prisma.level.findMany({
    where: { active: true },
    orderBy: { priority: 'asc' },
    select: { id: true, name: true, priority: true, transactionLimits: true },
  });
  const withLimits = levels.filter(
    (row) =>
      Array.isArray(row.transactionLimits) &&
      row.transactionLimits.length > 0 &&
      limitsFromLevelRow(row)
  );
  if (!withLimits.length) return null;
  // Prefer the second tier (e.g. "verified") when configured; otherwise lowest tier with limits.
  return withLimits.length > 1 ? withLimits[1] : withLimits[0];
}

/**
 * Assign a level on the customer row when missing (after signup / first tier-limits read).
 */
export async function ensureCustomerLevelAssigned(customerId) {
  const customerRow = await prisma.$queryRaw`
    SELECT id, "level" FROM customers WHERE id = ${customerId}
  `.then((rows) => rows?.[0]);
  if (!customerRow) return null;

  if (customerRow.level) {
    const existing = await prisma.level.findFirst({
      where: { id: customerRow.level, active: true },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const target = await resolveDefaultVerifiedLevel();
  if (!target?.id) return null;

  await prisma.$executeRaw`
    UPDATE customers SET "level" = ${target.id} WHERE id = ${customerId}
  `;
  return target.id;
}

/**
 * Get customer's transaction limits from their level (daily, weekly, monthly).
 * Assigns a default level when missing, then reads limits from that level.
 * Returns null if no limits configured (no limit enforced).
 */
export async function getCustomerLimits(customerId) {
  await ensureCustomerLevelAssigned(customerId);

  let level = null;
  const customerRow = await prisma.$queryRaw`
    SELECT id, "level" FROM customers WHERE id = ${customerId}
  `.then((rows) => rows?.[0]);
  if (customerRow?.level) {
    level = await prisma.level.findUnique({
      where: { id: customerRow.level },
      select: { id: true, name: true, priority: true, transactionLimits: true },
    });
  }
  if (!level?.transactionLimits) {
    level = await resolveDefaultVerifiedLevel();
  }
  if (!level) return null;
  return limitsFromLevelRow(level);
}

/**
 * Next active user level above the customer's current level (for upgrade messaging).
 */
export async function getNextLevelForCustomer(customerId) {
  await ensureCustomerLevelAssigned(customerId);

  const customerRow = await prisma.$queryRaw`
    SELECT id, "level" FROM customers WHERE id = ${customerId}
  `.then((rows) => rows?.[0]);

  const levels = await prisma.level.findMany({
    where: { active: true },
    orderBy: { priority: 'asc' },
    select: {
      id: true,
      name: true,
      priority: true,
      description: true,
      transactionLimits: true,
    },
  });

  if (!levels.length) return null;

  let currentPriority = -1;
  if (customerRow?.level) {
    const current = levels.find((l) => l.id === customerRow.level);
    if (current?.priority != null) currentPriority = Number(current.priority);
  }

  const next = levels.find((l) => Number(l.priority) > currentPriority);
  if (!next) return null;

  const parsed = limitsFromLevelRow(next);
  if (!parsed) return null;

  return {
    ...parsed,
    description: next.description ?? null,
  };
}

/**
 * Get total sent amount by customer in period [from, to] (UTC).
 */
export async function getSentInPeriod(customerId, from, to) {
  const result = await prisma.remittanceTransaction.aggregate({
    where: {
      customerId,
      type: 'Sent',
      createdAt: { gte: from, lte: to },
    },
    _sum: { sendAmount: true },
  });
  return Number(result._sum?.sendAmount ?? 0);
}

/**
 * Get the maximum per-transaction amount allowed by the customer's approved KYC form(s).
 * Each KYC form (e.g. "kyc2") can have a "Max Transaction Amount" (e.g. 2999). When a KYC doc
 * is approved, the user can transact up to that form's limit. If multiple KYCs are approved,
 * we use the highest of their limits.
 * Returns null if no KYC form has maxAmount or customer has no approved KYC.
 */
export async function getApprovedKYCMaxAmount(customerId) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { kycData: true },
  });
  if (!customer?.kycData) return null;
  let raw = customer.kycData;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const docs = Array.isArray(raw) ? raw : [raw];
  const approved = docs.filter((doc) => (doc.status || '').toLowerCase() === 'approved');
  if (approved.length === 0) return null;

  if (!prisma.kYCForm) return null;
  const forms = await prisma.kYCForm.findMany({
    where: { status: 'Active' },
    select: { name: true, maxAmount: true },
  });
  const formMaxByName = new Map(
    forms
      .filter((f) => f.maxAmount != null)
      .map((f) => [f.name, Number(f.maxAmount)])
  );

  let maxAllowed = null;
  for (const doc of approved) {
    const formName = doc.verificationType || doc.formName;
    if (!formName) continue;
    const formMax = formMaxByName.get(formName);
    if (formMax != null) {
      if (maxAllowed == null || formMax > maxAllowed) maxAllowed = formMax;
    }
  }
  return maxAllowed;
}

function isUserFacingKycForm(form) {
  return String(form.for ?? 'User').trim().toLowerCase() !== 'merchant';
}

function parseKycMaxAmount(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function scoreKycFormCountryFit(form, requestedTokens, rawCountry) {
  const list = (Array.isArray(form.countries) ? form.countries : [])
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean);
  if (!list.length) return 0;
  const raw = String(rawCountry || '').trim().toUpperCase();
  if (raw && list.includes(raw)) return 100;
  const overlap = list.filter((cc) => requestedTokens.has(cc)).length;
  if (!overlap) return 0;
  // Prefer tighter country lists (e.g. USD-only over PKR+USD).
  return 50 + overlap * 5 - list.length;
}

/**
 * Active user-facing KYC forms for a country (same rules as GET /kyc/forms/country/:code).
 */
export async function getActiveKycFormsForCountryTokens(
  requestedTokens,
  rawCountry = ''
) {
  if (!prisma.kYCForm) return [];
  const allForms = await prisma.kYCForm.findMany({
    where: { status: { in: ['Active', 'active'] } },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    select: {
      name: true,
      maxAmount: true,
      for: true,
      countries: true,
      priority: true,
      createdAt: true,
    },
  });
  return allForms
    .filter(isUserFacingKycForm)
    .filter((form) => kycFormMatchesCountryTokens(form, requestedTokens))
    .sort((a, b) => {
      const scoreDiff =
        scoreKycFormCountryFit(b, requestedTokens, rawCountry) -
        scoreKycFormCountryFit(a, requestedTokens, rawCountry);
      if (scoreDiff !== 0) return scoreDiff;
      const priA = Number(a.priority) || 999;
      const priB = Number(b.priority) || 999;
      if (priA !== priB) return priA - priB;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
}

/**
 * Primary KYC cap for a customer from portal-configured forms (priority 1 for their country).
 */
export async function getActiveKycMaxAmountForCustomer(customerId) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { country: true },
  });
  const rawCountry = String(customer?.country ?? '').trim();
  if (!rawCountry) {
    return getMinimumActiveKycMaxAmount();
  }
  const tokens = await expandKycCountryTokens(rawCountry);
  const forms = await getActiveKycFormsForCountryTokens(tokens, rawCountry);
  if (!forms.length) return null;
  const primary = forms[0];
  const primaryMax = parseKycMaxAmount(primary.maxAmount);
  if (primaryMax != null) return primaryMax;
  const amounts = forms
    .map((f) => parseKycMaxAmount(f.maxAmount))
    .filter((n) => n != null);
  return amounts.length ? Math.max(...amounts) : null;
}

/**
 * Max amount from the customer's submitted KYC (pending or approved), matched to active forms.
 */
export async function getSubmittedKycMaxAmount(customerId) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { kycData: true },
  });
  if (!customer?.kycData || !prisma.kYCForm) return null;

  let raw = customer.kycData;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const docs = Array.isArray(raw) ? raw : [raw];
  const relevant = docs.filter((doc) => {
    const status = String(doc.status || 'pending').toLowerCase();
    return status === 'approved' || status === 'pending';
  });
  if (!relevant.length) return null;

  const forms = await prisma.kYCForm.findMany({
    where: { status: { in: ['Active', 'active'] } },
    select: { name: true, maxAmount: true },
  });
  const formMaxByName = new Map(
    forms
      .map((f) => [f.name, parseKycMaxAmount(f.maxAmount)])
      .filter(([, n]) => n != null)
  );

  let maxAllowed = null;
  for (const doc of relevant) {
    const formName = doc.verificationType || doc.formName;
    if (!formName) continue;
    const formMax = formMaxByName.get(formName);
    if (formMax != null) {
      maxAllowed = maxAllowed == null ? formMax : Math.max(maxAllowed, formMax);
    }
  }
  return maxAllowed;
}

/**
 * Lowest per-transaction cap among active user-facing KYC forms (global fallback).
 */
export async function getMinimumActiveKycMaxAmount() {
  if (!prisma.kYCForm) return null;
  const forms = await prisma.kYCForm.findMany({
    where: { status: { in: ['Active', 'active'] } },
    select: { maxAmount: true, for: true },
  });
  const amounts = forms
    .filter(isUserFacingKycForm)
    .map((f) => parseKycMaxAmount(f.maxAmount))
    .filter((n) => n != null);
  return amounts.length ? Math.min(...amounts) : null;
}
