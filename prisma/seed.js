import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');
  // Create super admin
  const hashedPassword = await bcrypt.hash('admin', 10);
  const inviteToken = randomBytes(32).toString('hex');
  const inviteTokenExp = new Date();
  inviteTokenExp.setFullYear(inviteTokenExp.getFullYear() + 1); // Never expires for super admin

  const superAdmin = await prisma.backofficeUser.upsert({
    where: { email: 'admin@brandpay.com' },
    update: {
      username: 'admin',
      password: hashedPassword,
      status: 'approved',
      isSuperAdmin: true,
      approvedAt: new Date(),
      approvedBy: 'system',
      profileCompletedAt: new Date()
    },
    create: {
      email: 'admin@brandpay.com',
      username: 'admin',
      firstName: 'Super',
      lastName: 'Admin',
      password: hashedPassword,
      inviteToken,
      inviteTokenExp,
      status: 'approved',
      isSuperAdmin: true,
      invitedBy: 'system',
      approvedAt: new Date(),
      approvedBy: 'system',
      profileCompletedAt: new Date()
    }
  });

  console.log('✅ Super admin created:', superAdmin.email);
  console.log('   Username: admin');
  console.log('   Password: admin');

  // Create default services
  const defaultServices = [
    { name: 'Airtime', status: 'Active' },
    { name: 'Mobile Money Transfer', status: 'Active' },
    { name: 'Bank Transfer', status: 'Active' },
    { name: 'Cash Pick-Up', status: 'Active' },
  ];

  for (const serviceData of defaultServices) {
    const existingService = await prisma.service.findUnique({
      where: { name: serviceData.name },
    });

    if (!existingService) {
      await prisma.service.create({
        data: serviceData,
      });
      console.log(`✅ Service created: ${serviceData.name}`);
    } else {
      console.log(`ℹ️ Service already exists: ${serviceData.name}`);
    }
  }

  // Create default purposes
  const defaultPurposes = [
    { name: 'Payment of services or Invoice', status: 'Active' },
    { name: 'Property or Large purchase', status: 'Active' },
    { name: 'School fees', status: 'Active' },
  ];

  for (const purposeData of defaultPurposes) {
    const existingPurpose = await prisma.purpose.findUnique({
      where: { name: purposeData.name },
    });

    if (!existingPurpose) {
      await prisma.purpose.create({
        data: purposeData,
      });
      console.log(`✅ Purpose created: ${purposeData.name}`);
    } else {
      console.log(`ℹ️ Purpose already exists: ${purposeData.name}`);
    }
  }

  // Create default source of funds
  const defaultSourceOfFunds = [
    { name: 'Salary or wages', status: 'Active' },
    { name: 'Business income', status: 'Active' },
    { name: 'Investments', status: 'Active' },
    { name: 'Gift or inheritance', status: 'Active' },
    { name: 'Savings', status: 'Active' },
    { name: 'Other', status: 'Active' },
  ];

  const defaultEmploymentStatuses = [
    { name: 'Employed full-time', status: 'Active' },
    { name: 'Self-employed', status: 'Active' },
    { name: 'Student', status: 'Active' },
    { name: 'Retired', status: 'Active' },
    { name: 'Unemployed', status: 'Active' },
    { name: 'Other', status: 'Active' },
  ];

  try {
    for (const row of defaultEmploymentStatuses) {
      const existing = await prisma.employmentStatus.findUnique({
        where: { name: row.name },
      });
      if (!existing) {
        await prisma.employmentStatus.create({ data: row });
        console.log(`✅ Employment status created: ${row.name}`);
      }
    }
  } catch (e) {
    console.warn('ℹ️ Employment statuses seed skipped (run API or migrate first):', e.message);
  }

  for (const sourceData of defaultSourceOfFunds) {
    const existingSource = await prisma.sourceOfFund.findUnique({
      where: { name: sourceData.name },
    });

    if (!existingSource) {
      await prisma.sourceOfFund.create({
        data: sourceData,
      });
      console.log(`✅ Source of fund created: ${sourceData.name}`);
    } else {
      console.log(`ℹ️ Source of fund already exists: ${sourceData.name}`);
    }
  }

  // Dev-friendly default KYC form so GET /api/kyc/forms/country/:code returns data locally.
  // Empty `countries` means "all countries" (see getKYCFormsByCountry in kyc.controller.js).
  const devKycName = 'Standard identity verification (dev)';
  const existingDevKyc = await prisma.kYCForm.findFirst({
    where: { name: devKycName },
  });
  if (!existingDevKyc) {
    await prisma.kYCForm.create({
      data: {
        name: devKycName,
        description: 'Required for wallet activation, deposits, and transfers',
        for: 'User',
        status: 'Active',
        countries: [],
        priority: 1,
        fields: [
          {
            id: 'dev-id-front',
            fieldName: 'Government ID (front)',
            inputType: 'Upload',
            validationType: 'Required',
          },
          {
            id: 'dev-id-back',
            fieldName: 'Government ID (back)',
            inputType: 'Upload',
            validationType: 'Required',
          },
        ],
      },
    });
    console.log(`✅ KYC form created: ${devKycName}`);
  } else {
    console.log(`ℹ️ KYC form already exists: ${devKycName}`);
  }

  // Demo remittance banks for India (local dev) — app lists banks where assignedCountries includes IN + Active
  const india = await prisma.country.findFirst({
    where: { iso2: 'IN' },
    select: { id: true, iso2: true, name: true, currencyCode: true, currencyRate: true },
  });
  if (india) {
    const rate =
      india.currencyRate != null && String(india.currencyRate).trim() !== ''
        ? String(india.currencyRate)
        : '83';
    const indiaAssignment = {
      countryCode: india.iso2,
      country: india.name,
      dollarPrice: rate,
      status: 'Active',
    };
    const demoNames = ['HDFC Bank (India demo)', 'State Bank of India (demo)'];
    for (const name of demoNames) {
      let bank = await prisma.remittanceBank.findFirst({ where: { name } });
      if (!bank) {
        bank = await prisma.remittanceBank.create({
          data: {
            name,
            website: 'https://example.com',
            active: true,
            assignedCountries: [indiaAssignment],
          },
        });
        console.log(`✅ Remittance bank created for India: ${bank.name}`);
      } else {
        let ac = Array.isArray(bank.assignedCountries) ? [...bank.assignedCountries] : [];
        const hasIn = ac.some(
          (x) =>
            String(x?.countryCode || '').toUpperCase() === 'IN' &&
            String(x?.status ?? 'Active').toLowerCase() === 'active'
        );
        if (!hasIn) {
          ac.push(indiaAssignment);
          await prisma.remittanceBank.update({
            where: { id: bank.id },
            data: { assignedCountries: ac },
          });
          console.log(`✅ Attached India to remittance bank: ${bank.name}`);
        }
      }
    }
  } else {
    console.log('ℹ️ No country with iso2=IN in DB — skip India demo banks (add India under Manage Country first).');
  }

  const defaultFaqs = [
    {
      question: 'How do I register on the app?',
      answer:
        'Download the app, enter your details, verify your phone or email with the OTP we send, then complete KYC verification to start sending money.',
      order: 1,
    },
    {
      question: 'What documents are required for KYC verification?',
      answer:
        'You may need a valid government ID (passport or national ID) and a selfie. Requirements can vary by country and transfer amount.',
      order: 2,
    },
    {
      question: 'How long do transfers take?',
      answer:
        'Most transfers are processed within minutes. Bank and wallet delivery times depend on the destination country and payout partner.',
      order: 3,
    },
    {
      question: 'How can I contact support?',
      answer:
        'Open Help and Support from your profile to use live chat, email, or phone support.',
      order: 4,
    },
  ];

  const existingFaqCount = await prisma.fAQ.count();
  if (existingFaqCount === 0) {
    for (const faq of defaultFaqs) {
      await prisma.fAQ.create({ data: faq });
      console.log(`✅ FAQ created: ${faq.question}`);
    }
  } else {
    console.log(`ℹ️ FAQs already exist (${existingFaqCount}) — skip FAQ seed`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

