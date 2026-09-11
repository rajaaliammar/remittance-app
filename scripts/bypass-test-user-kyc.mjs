/**
 * One-off: mark test@onezapay.com as fully KYC-verified / approved for remittance.
 * Usage: node scripts/bypass-test-user-kyc.mjs
 */
import prisma from '../src/utils/prisma.js';
import { kycDataSatisfiesVerification } from '../src/utils/amlAutoApprove.js';

const EMAIL = 'test@onezapay.com';

async function main() {
  const before = await prisma.customer.findFirst({
    where: { email: { equals: EMAIL, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      status: true,
      approvedAt: true,
      approvedBy: true,
      level: true,
      balanceLimit: true,
      kycData: true,
      kycRequestedAt: true,
    },
  });

  if (!before) {
    throw new Error(`Customer not found: ${EMAIL}`);
  }

  console.log('BEFORE:', {
    id: before.id,
    email: before.email,
    status: before.status,
    approvedAt: before.approvedAt,
    approvedBy: before.approvedBy,
    level: before.level,
    balanceLimit: before.balanceLimit,
    kycSatisfies: kycDataSatisfiesVerification(before.kycData),
    kycData: before.kycData,
  });

  const levels = await prisma.level.findMany({
    where: { active: true },
    orderBy: { priority: 'asc' },
    select: { id: true, name: true, priority: true },
  });
  // Prefer second-lowest tier when available (same idea as ensureCustomerLevelAssigned)
  const targetLevel = levels.length >= 2 ? levels[1] : levels[0] || null;

  const forms = await prisma.kYCForm.findMany({
    where: { status: { in: ['Active', 'active'] } },
    select: { name: true, maxAmount: true, for: true, priority: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  const userForm =
    forms.find((f) => String(f.for ?? 'User').toLowerCase() !== 'merchant') ||
    forms[0] ||
    null;
  const formName = userForm?.name || 'National ID';
  const now = new Date().toISOString();

  // Strip LiveEx digitalOnboarding rows that would require onBoardStatusId === 3;
  // remittance gate treats LiveEx rowIdGid as authoritative over status=approved.
  let raw = before.kycData;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const existingDocs = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  const cleanedDocs = existingDocs
    .filter((doc) => doc && typeof doc === 'object')
    .map((doc) => {
      const next = { ...doc };
      delete next.digitalOnboarding;
      delete next.paths;
      delete next.rowIdGid;
      if (next.aml && typeof next.aml === 'object') {
        next.aml = { ...next.aml };
      }
      return next;
    })
    .filter((doc) => {
      // Drop empty shells that were only LiveEx metadata
      return (
        doc.verificationType ||
        doc.formName ||
        doc.status ||
        (Array.isArray(doc.documents) && doc.documents.length) ||
        doc.aml
      );
    });

  const approvedEntry = {
    id: `test_kyc_bypass_${Date.now()}`,
    verificationType: formName,
    formName,
    status: 'approved',
    submittedAt: now,
    approvedAt: now,
    approvedBy: 'test-kyc-bypass',
    date: now,
    documents: [
      {
        id: `field_front_${Date.now()}`,
        fieldName: 'National ID Front',
        inputType: 'file',
        status: 'approved',
        approvedAt: now,
      },
      {
        id: `field_back_${Date.now()}`,
        fieldName: 'National ID Back',
        inputType: 'file',
        status: 'approved',
        approvedAt: now,
      },
    ],
  };

  const hasApprovedNamed = cleanedDocs.some(
    (d) =>
      String(d.status || '').toLowerCase() === 'approved' &&
      (d.verificationType || d.formName),
  );
  const nextKyc = hasApprovedNamed
    ? cleanedDocs.map((d) => {
        if (String(d.status || '').toLowerCase() === 'approved') return d;
        return {
          ...d,
          status: 'approved',
          approvedAt: d.approvedAt || now,
          approvedBy: d.approvedBy || 'test-kyc-bypass',
        };
      })
    : [...cleanedDocs, approvedEntry];

  const updated = await prisma.customer.update({
    where: { id: before.id },
    data: {
      status: 'approved',
      approvedAt: before.approvedAt || new Date(),
      approvedBy: before.approvedBy || 'test-kyc-bypass',
      kycData: nextKyc,
      kycRequestedAt: null,
      kycRequestedBy: null,
      kycRequestedFormId: null,
      kycRequestedFormName: null,
      kycRequestedMessage: null,
      kycRequestedFields: null,
      ...(targetLevel && !before.level ? { level: targetLevel.id } : {}),
      ...(before.balanceLimit == null || before.balanceLimit === ''
        ? { balanceLimit: '100000' }
        : {}),
    },
    select: {
      id: true,
      email: true,
      status: true,
      approvedAt: true,
      approvedBy: true,
      level: true,
      balanceLimit: true,
      kycData: true,
    },
  });

  console.log('AFTER:', {
    id: updated.id,
    email: updated.email,
    status: updated.status,
    approvedAt: updated.approvedAt,
    approvedBy: updated.approvedBy,
    level: updated.level,
    balanceLimit: updated.balanceLimit,
    kycSatisfies: kycDataSatisfiesVerification(updated.kycData),
    kycData: updated.kycData,
    assignedLevel: targetLevel,
    kycFormUsed: formName,
    formMaxAmount: userForm?.maxAmount ?? null,
  });

  if (!kycDataSatisfiesVerification(updated.kycData)) {
    throw new Error('Update applied but kycDataSatisfiesVerification still returns false');
  }

  console.log(`OK: ${EMAIL} is KYC-verified and approved for transactions.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
