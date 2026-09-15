import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { ensureDefaultKycForms } from '../src/utils/ensureDefaultKycForms.js';

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
    { name: 'Family Support', status: 'Active' },
    { name: 'Education', status: 'Active' },
    { name: 'Gift', status: 'Active' },
    { name: 'Personal Savings', status: 'Active' },
    { name: 'Payment of services or Invoice', status: 'Active' },
    { name: 'Property or Large purchase', status: 'Active' },
    { name: 'School fees', status: 'Active' },
    { name: 'Medical expenses', status: 'Active' },
    { name: 'Business expenses', status: 'Active' },
    { name: 'Other', status: 'Active' },
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

  await ensureDefaultKycForms();

  // Ensure core demo countries + banks exist for local Send / Bank Selection testing
  const demoCountrySeed = [
    { iso2: 'US', iso3: 'USA', name: 'United States', phoneCode: '+1', currencyName: 'US Dollar', currencyCode: 'USD', currencyRate: '1', continent: 'North America', popular: true },
    { iso2: 'CA', iso3: 'CAN', name: 'Canada', phoneCode: '+1', currencyName: 'Canadian Dollar', currencyCode: 'CAD', currencyRate: '1.36', continent: 'North America', popular: true },
    { iso2: 'GB', iso3: 'GBR', name: 'United Kingdom', phoneCode: '+44', currencyName: 'Pound Sterling', currencyCode: 'GBP', currencyRate: '0.79', continent: 'Europe', popular: true },
    { iso2: 'ET', iso3: 'ETH', name: 'Ethiopia', phoneCode: '+251', currencyName: 'Ethiopian Birr', currencyCode: 'ETB', currencyRate: '57', continent: 'Africa', popular: true },
    { iso2: 'IN', iso3: 'IND', name: 'India', phoneCode: '+91', currencyName: 'Indian Rupee', currencyCode: 'INR', currencyRate: '83', continent: 'Asia', popular: true },
    { iso2: 'MX', iso3: 'MEX', name: 'Mexico', phoneCode: '+52', currencyName: 'Mexican Peso', currencyCode: 'MXN', currencyRate: '17', continent: 'North America', popular: false },
    { iso2: 'PH', iso3: 'PHL', name: 'Philippines', phoneCode: '+63', currencyName: 'Philippine Peso', currencyCode: 'PHP', currencyRate: '56', continent: 'Asia', popular: false },
    { iso2: 'NG', iso3: 'NGA', name: 'Nigeria', phoneCode: '+234', currencyName: 'Nigerian Naira', currencyCode: 'NGN', currencyRate: '1550', continent: 'Africa', popular: false },
  ];
  const demoBanksByIso2 = {
    US: [
      { name: 'Chase (US demo)', website: 'https://www.chase.com' },
      { name: 'Bank of America (US demo)', website: 'https://www.bankofamerica.com' },
    ],
    CA: [
      { name: 'RBC Royal Bank (CA demo)', website: 'https://www.rbcroyalbank.com' },
      { name: 'TD Canada Trust (CA demo)', website: 'https://www.td.com' },
    ],
    GB: [
      { name: 'Barclays (GB demo)', website: 'https://www.barclays.co.uk' },
      { name: 'HSBC UK (GB demo)', website: 'https://www.hsbc.co.uk' },
    ],
    ET: [
      { name: 'Commercial Bank of Ethiopia (ET demo)', website: 'https://www.combanketh.et' },
    ],
    IN: [
      { name: 'HDFC Bank (IN demo)', website: 'https://www.hdfcbank.com' },
      { name: 'State Bank of India (IN demo)', website: 'https://www.sbi.co.in' },
    ],
    MX: [
      { name: 'BBVA México (MX demo)', website: 'https://www.bbva.mx' },
      { name: 'Banorte (MX demo)', website: 'https://www.banorte.com' },
    ],
    PH: [
      { name: 'BDO Unibank (PH demo)', website: 'https://www.bdo.com.ph' },
      { name: 'BPI (PH demo)', website: 'https://www.bpi.com.ph' },
    ],
    NG: [
      { name: 'Guaranty Trust Bank (NG demo)', website: 'https://www.gtbank.com' },
      { name: 'Zenith Bank (NG demo)', website: 'https://www.zenithbank.com' },
    ],
  };
  for (const row of demoCountrySeed) {
    let continent = await prisma.continent.findFirst({ where: { name: row.continent } });
    if (!continent) {
      continent = await prisma.continent.create({ data: { name: row.continent, status: 'Active' } });
    }
    let country = await prisma.country.findFirst({ where: { iso2: row.iso2 } });
    if (!country) {
      country = await prisma.country.create({
        data: {
          continentId: continent.id,
          name: row.name,
          iso2: row.iso2,
          iso3: row.iso3,
          phoneCode: row.phoneCode,
          currencyName: row.currencyName,
          currencyCode: row.currencyCode,
          currencyRate: row.currencyRate,
          isPopular: row.popular,
          status: 'Active',
          sendable: true,
          receivable: true,
        },
      });
      console.log(`✅ Country created: ${country.iso2}`);
    } else {
      const patch = {};
      if (!country.receivable || !country.sendable || country.status !== 'Active') {
        patch.receivable = true;
        patch.sendable = true;
        patch.status = 'Active';
      }
      // Backfill missing FX so POST /remittance-transactions can lock a rate
      const existingRate = country.currencyRate != null ? String(country.currencyRate).trim() : '';
      if (!existingRate || !(parseFloat(existingRate) > 0)) {
        patch.currencyRate = row.currencyRate;
      }
      if (!country.currencyCode && row.currencyCode) {
        patch.currencyCode = row.currencyCode;
      }
      if (Object.keys(patch).length) {
        country = await prisma.country.update({
          where: { id: country.id },
          data: patch,
        });
        console.log(`✅ Country updated for FX/receivable: ${country.iso2}`);
      }
    }
    const banks = demoBanksByIso2[row.iso2] || [];
    for (const bankSeed of banks) {
      let bank = await prisma.remittanceBank.findFirst({ where: { name: bankSeed.name } });
      const assignment = {
        countryCode: row.iso2,
        country: row.name,
        dollarPrice: row.currencyRate,
        status: 'Active',
      };
      if (!bank) {
        await prisma.remittanceBank.create({
          data: {
            name: bankSeed.name,
            website: bankSeed.website,
            active: true,
            dollarRate: row.currencyRate,
            assignedCountries: [assignment],
          },
        });
        console.log(`✅ Remittance bank created: ${bankSeed.name}`);
      } else {
        const bankPatch = {};
        const bankRate = bank.dollarRate != null ? String(bank.dollarRate).trim() : '';
        if (!bankRate || !(parseFloat(bankRate) > 0)) {
          bankPatch.dollarRate = row.currencyRate;
        }
        let ac = Array.isArray(bank.assignedCountries) ? [...bank.assignedCountries] : [];
        const idx = ac.findIndex(
          (x) => String(x?.countryCode || '').toUpperCase() === row.iso2
        );
        if (idx < 0) {
          ac.push(assignment);
          bankPatch.assignedCountries = ac;
        } else {
          const price = ac[idx]?.dollarPrice != null ? String(ac[idx].dollarPrice).trim() : '';
          if (!price || !(parseFloat(price) > 0)) {
            ac[idx] = { ...ac[idx], ...assignment };
            bankPatch.assignedCountries = ac;
          }
        }
        if (Object.keys(bankPatch).length) {
          await prisma.remittanceBank.update({
            where: { id: bank.id },
            data: bankPatch,
          });
          console.log(`✅ Remittance bank FX backfilled: ${bankSeed.name}`);
        }
      }
    }
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
            dollarRate: rate,
            assignedCountries: [indiaAssignment],
          },
        });
        console.log(`✅ Remittance bank created for India: ${bank.name}`);
      } else {
        const bankPatch = {};
        const bankRate = bank.dollarRate != null ? String(bank.dollarRate).trim() : '';
        if (!bankRate || !(parseFloat(bankRate) > 0)) {
          bankPatch.dollarRate = rate;
        }
        let ac = Array.isArray(bank.assignedCountries) ? [...bank.assignedCountries] : [];
        const hasIn = ac.some(
          (x) =>
            String(x?.countryCode || '').toUpperCase() === 'IN' &&
            String(x?.status ?? 'Active').toLowerCase() === 'active'
        );
        if (!hasIn) {
          ac.push(indiaAssignment);
          bankPatch.assignedCountries = ac;
        } else {
          ac = ac.map((x) => {
            if (String(x?.countryCode || '').toUpperCase() !== 'IN') return x;
            const price = x?.dollarPrice != null ? String(x.dollarPrice).trim() : '';
            if (!price || !(parseFloat(price) > 0)) {
              return { ...x, dollarPrice: rate, status: x.status || 'Active' };
            }
            return x;
          });
          bankPatch.assignedCountries = ac;
        }
        if (Object.keys(bankPatch).length) {
          await prisma.remittanceBank.update({
            where: { id: bank.id },
            data: bankPatch,
          });
          console.log(`✅ Attached/backfilled India FX on remittance bank: ${bank.name}`);
        }
      }
    }
  } else {
    console.log('ℹ️ No country with iso2=IN in DB — skip India demo banks (add India under Manage Country first).');
  }

  // Backfill any Active receivable country still missing a positive currencyRate
  // using currency-code defaults so FX lock does not fail for portal-created rows.
  const currencyDefaults = {
    USD: '1',
    CAD: '1.36',
    GBP: '0.79',
    ETB: '57',
    INR: '83',
    MXN: '17',
    PHP: '56',
    NGN: '1550',
    EUR: '0.92',
    AUD: '1.52',
    KES: '129',
    GHS: '15.5',
  };
  const countriesMissingRate = await prisma.country.findMany({
    where: { status: 'Active', receivable: true },
    select: { id: true, iso2: true, currencyCode: true, currencyRate: true },
  });
  for (const c of countriesMissingRate) {
    const rateStr = c.currencyRate != null ? String(c.currencyRate).trim() : '';
    if (rateStr && parseFloat(rateStr) > 0) continue;
    const code = String(c.currencyCode || '').toUpperCase();
    const fallback = currencyDefaults[code];
    if (!fallback) continue;
    await prisma.country.update({
      where: { id: c.id },
      data: { currencyRate: fallback },
    });
    console.log(`✅ Backfilled currencyRate for ${c.iso2 || c.id}: ${fallback}`);
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

