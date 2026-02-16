import prisma from './prisma.js';

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

/**
 * Get customer's transaction limits from their level (daily, weekly, monthly).
 * If customer has no level, use the first level (lowest priority).
 * Returns null if no limits configured (no limit enforced).
 */
export async function getCustomerLimits(customerId) {
  let level = null;
  const customerRow = await prisma.$queryRaw`
    SELECT id, "level" FROM customers WHERE id = ${customerId}
  `.then((rows) => rows?.[0]);
  if (customerRow?.level) {
    level = await prisma.level.findUnique({
      where: { id: customerRow.level },
      select: { id: true, name: true, transactionLimits: true },
    });
  }
  if (!level?.transactionLimits) {
    const firstLevel = await prisma.level.findFirst({
      orderBy: { priority: 'asc' },
      select: { id: true, name: true, transactionLimits: true },
    });
    level = firstLevel;
  }
  if (!level?.transactionLimits || !Array.isArray(level.transactionLimits) || level.transactionLimits.length === 0) {
    return null;
  }
  const first = level.transactionLimits[0];
  const daily = first.dailyAmount != null ? Number(first.dailyAmount) : null;
  const weekly = first.weeklyAmount != null ? Number(first.weeklyAmount) : null;
  const monthly = first.monthlyAmount != null ? Number(first.monthlyAmount) : null;
  const currency = first.currency || 'USD';
  if (daily == null && weekly == null && monthly == null) return null;
  return {
    daily,
    weekly,
    monthly,
    currency,
    levelId: level.id,
    levelName: level.name,
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
