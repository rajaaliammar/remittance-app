import prisma from './prisma.js';

/**
 * Portal-aligned default KYC steps for the mobile registration flow.
 * Countries use currency codes (USD, ETB, …) as stored in the portal.
 */
const DEFAULT_KYC_FORMS = [
  {
    name: 'U.S. Passport',
    description: 'Government-issued passport',
    for: 'User',
    status: 'Active',
    countries: ['USD', 'US', 'ETB', 'ET', 'PKR', 'PK', 'CAD', 'CA'],
    priority: 1,
    maxAmount: 5000,
    fields: [
      {
        id: 'passport-upload',
        fieldName: 'Passport',
        inputType: 'Upload 1',
        validationType: 'Required',
      },
    ],
  },
  {
    name: "Driver's License",
    description: 'Front and back of your license',
    for: 'User',
    status: 'Active',
    countries: ['USD', 'US', 'ETB', 'ET', 'PKR', 'PK', 'CAD', 'CA'],
    priority: 2,
    maxAmount: 800,
    fields: [
      {
        id: 'dl-upload',
        fieldName: 'Driver License',
        inputType: 'Upload 2',
        validationType: 'Required',
      },
    ],
  },
  {
    name: 'State Id',
    description: 'Documents required to complete due diligence',
    for: 'User',
    status: 'Active',
    countries: ['USD', 'US', 'ETB', 'ET', 'PKR', 'PK', 'CAD', 'CA'],
    priority: 3,
    maxAmount: 2999,
    fields: [
      {
        id: 'state-id-upload',
        fieldName: 'ID Card',
        inputType: 'Upload 2',
        validationType: 'Required',
      },
    ],
  },
  {
    name: 'Photo',
    description: 'Clear photo for identity match',
    for: 'User',
    status: 'Active',
    countries: ['USD', 'US', 'ETB', 'ET', 'PKR', 'PK', 'CAD', 'CA'],
    priority: 4,
    maxAmount: 2000,
    fields: [
      {
        id: 'photo-upload',
        fieldName: 'Photo',
        inputType: 'Upload',
        validationType: 'Required',
      },
    ],
  },
  {
    name: 'Proof of address',
    description: 'Utility bill or bank statement (last 90 days)',
    for: 'User',
    status: 'Active',
    countries: ['USD', 'US', 'ETB', 'ET', 'PKR', 'PK', 'CAD', 'CA'],
    priority: 5,
    maxAmount: 10000,
    fields: [
      {
        id: 'poa-upload',
        fieldName: 'Proof of address document',
        inputType: 'Upload 1',
        validationType: 'Required',
      },
    ],
  },
];

let ensurePromise = null;

/**
 * Seeds default KYC forms when the database has none (common on fresh local dev DBs).
 * Portal-created forms are never removed.
 */
export async function ensureDefaultKycForms() {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    try {
      if (!prisma.kYCForm) {
        console.warn('[KYC] Prisma kYCForm model missing — run npx prisma generate');
        return 0;
      }

      const activeForms = await prisma.kYCForm.findMany({
        where: { status: { in: ['Active', 'active'] } },
        select: { id: true, for: true },
      });
      const userFacingCount = activeForms.filter(
        (f) => String(f.for ?? 'User').trim().toLowerCase() !== 'merchant'
      ).length;
      if (userFacingCount > 0) {
        return userFacingCount;
      }

      for (const form of DEFAULT_KYC_FORMS) {
        await prisma.kYCForm.create({
          data: {
            name: form.name,
            description: form.description,
            for: form.for,
            status: form.status,
            countries: form.countries,
            fields: form.fields,
            priority: form.priority,
            maxAmount: form.maxAmount,
          },
        });
      }
      console.log(`✅ Seeded ${DEFAULT_KYC_FORMS.length} default KYC forms`);
      return DEFAULT_KYC_FORMS.length;
    } catch (err) {
      console.warn('[KYC] ensureDefaultKycForms failed:', err?.message || err);
      return 0;
    } finally {
      ensurePromise = null;
    }
  })();

  return ensurePromise;
}
