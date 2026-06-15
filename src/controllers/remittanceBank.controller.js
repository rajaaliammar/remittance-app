import prisma from '../utils/prisma.js';
import { syncBankToCountryServices } from '../utils/syncBankCountryServices.js';
import { sanitizeLogoField } from '../utils/imageFieldSanitizer.js';

// Get all remittance banks
export const getAllRemittanceBanks = async (req, res) => {
  try {
    const { search, active } = req.query;

    const where = {};
    
    if (active !== undefined) {
      where.active = active === 'true';
    }
    
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const banks = await prisma.remittanceBank.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Format the response to include assignedCountries as array
    const formattedBanks = banks.map(bank => ({
      ...bank,
      assignedCountries: bank.assignedCountries ? (Array.isArray(bank.assignedCountries) ? bank.assignedCountries : []) : []
    }));

    res.json({ success: true, data: formattedBanks });
  } catch (error) {
    console.error('Error fetching remittance banks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get remittance banks by country
export const getBanksByCountry = async (req, res) => {
  try {
    const { countryId } = req.params;
    const { serviceId } = req.query;

    if (!countryId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Country ID is required' 
      });
    }

    // Get the country to find its ISO2 code
    const country = await prisma.country.findUnique({
      where: { id: countryId },
      select: {
        id: true,
        iso2: true,
        iso3: true,
        name: true,
        currencyCode: true,
        currencyRate: true,
      },
    });

    if (!country) {
      return res.status(404).json({ 
        success: false, 
        message: 'Country not found' 
      });
    }

    // Get all active banks
    const allBanks = await prisma.remittanceBank.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' }
    });

    const iso2 = String(country.iso2 || '').toUpperCase();
    const iso3 = String(country.iso3 || '').toUpperCase();
    const cur = country.currencyCode != null ? String(country.currencyCode).trim().toUpperCase() : '';

    // Filter banks that have this country in their assignedCountries
    const banksForCountry = allBanks.filter((bank) => {
      if (!bank.assignedCountries) return false;

      let assignedCountries = Array.isArray(bank.assignedCountries)
        ? bank.assignedCountries
        : [];
      // Legacy: stored as JSON string
      if (!assignedCountries.length && typeof bank.assignedCountries === 'string') {
        try {
          const p = JSON.parse(bank.assignedCountries);
          assignedCountries = Array.isArray(p) ? p : [];
        } catch {
          assignedCountries = [];
        }
      }

      return assignedCountries.some((ac) => {
        const code = ac?.countryCode != null ? String(ac.countryCode).trim().toUpperCase() : '';
        const name = ac?.country != null ? String(ac.country).trim() : '';
        const matchesCountry =
          code === iso2 ||
          code === iso3 ||
          (cur && code === cur) ||
          ac.countryCode === country.id ||
          name.toLowerCase() === String(country.name || '').trim().toLowerCase() ||
          name.toUpperCase() === iso2;

        const statusOk = String(ac?.status ?? 'Active').toLowerCase() === 'active';
        return matchesCountry && statusOk;
      });
    });

    // Prefer portal-uploaded image from active Bank Transfer country service (per bank + country)
    const bankIds = banksForCountry.map((b) => b.id);
    const serviceImagesByBankId = new Map();
    if (bankIds.length > 0) {
      const countryServices = await prisma.countryService.findMany({
        where: {
          countryId,
          status: 'Active',
          serviceType: 'Bank Transfer',
          remittanceBankId: { in: bankIds },
          displayImage: { not: null },
        },
        select: { remittanceBankId: true, displayImage: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      });
      for (const row of countryServices) {
        if (row.remittanceBankId && row.displayImage && !serviceImagesByBankId.has(row.remittanceBankId)) {
          serviceImagesByBankId.set(row.remittanceBankId, row.displayImage);
        }
      }
    }

    let resultBanks = banksForCountry;

    if (serviceId) {
      const svc = await prisma.countryService.findFirst({
        where: { id: String(serviceId), countryId, status: 'Active' },
        select: { remittanceBankId: true },
      });
      if (svc?.remittanceBankId) {
        const linked = banksForCountry.filter((b) => b.id === svc.remittanceBankId);
        if (linked.length > 0) {
          resultBanks = linked;
        } else {
          const single = await prisma.remittanceBank.findUnique({
            where: { id: svc.remittanceBankId },
          });
          if (single?.active) {
            resultBanks = [single];
          }
        }
      }
    }

    // Format the response
    const formattedBanks = resultBanks.map((bank) => ({
      id: bank.id,
      name: bank.name,
      logo: serviceImagesByBankId.get(bank.id) || bank.logo,
      website: bank.website,
      email: bank.email,
      phoneNumber: bank.phoneNumber,
      address: bank.address,
      active: bank.active,
      dollarRate: bank.dollarRate,
      assignedCountries: bank.assignedCountries
        ? Array.isArray(bank.assignedCountries)
          ? bank.assignedCountries
          : []
        : [],
    }));

    res.json({
      success: true,
      data: formattedBanks,
      country: {
        id: country.id,
        currencyCode: country.currencyCode || null,
        currencyRate: country.currencyRate || null,
      },
    });
  } catch (error) {
    console.error('Error fetching banks by country:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get remittance bank by ID
export const getRemittanceBankById = async (req, res) => {
  try {
    const { id } = req.params;

    const bank = await prisma.remittanceBank.findUnique({
      where: { id }
    });

    if (!bank) {
      return res.status(404).json({ success: false, message: 'Remittance bank not found' });
    }

    // Format assignedCountries as array
    const formattedBank = {
      ...bank,
      assignedCountries: bank.assignedCountries ? (Array.isArray(bank.assignedCountries) ? bank.assignedCountries : []) : []
    };

    res.json({
      success: true,
      data: formattedBank
    });
  } catch (error) {
    console.error('Error fetching remittance bank:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new remittance bank
export const createRemittanceBank = async (req, res) => {
  try {
    const { name, logo, website, email, phoneNumber, address, active, assignedCountries, dollarRate } = req.body;

    if (!name || !website) {
      return res.status(400).json({ 
        success: false, 
        message: 'Bank name and website are required' 
      });
    }

    const bank = await prisma.remittanceBank.create({
      data: {
        name: name.trim(),
        logo: logo ? await sanitizeLogoField(logo, 'banks') : null,
        website: website.trim(),
        email: email?.trim() || null,
        phoneNumber: phoneNumber?.trim() || null,
        address: address?.trim() || null,
        active: active !== undefined ? active : true,
        dollarRate: dollarRate !== undefined && dollarRate !== null ? String(dollarRate) : null,
        assignedCountries: assignedCountries && Array.isArray(assignedCountries) ? assignedCountries : null
      }
    });

    await syncBankToCountryServices(bank);

    // Format assignedCountries as array
    const formattedBank = {
      ...bank,
      assignedCountries: bank.assignedCountries ? (Array.isArray(bank.assignedCountries) ? bank.assignedCountries : []) : []
    };

    res.status(201).json({
      success: true,
      message: 'Remittance bank created successfully',
      data: formattedBank
    });
  } catch (error) {
    console.error('Error creating remittance bank:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update remittance bank
export const updateRemittanceBank = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, logo, website, email, phoneNumber, address, active, assignedCountries, dollarRate } = req.body;

    const bank = await prisma.remittanceBank.findUnique({
      where: { id }
    });

    if (!bank) {
      return res.status(404).json({ 
        success: false, 
        message: 'Remittance bank not found' 
      });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (logo !== undefined) updateData.logo = logo ? await sanitizeLogoField(logo, 'banks') : null;
    if (website !== undefined) updateData.website = website.trim();
    if (email !== undefined) updateData.email = email?.trim() || null;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber?.trim() || null;
    if (address !== undefined) updateData.address = address?.trim() || null;
    if (active !== undefined) updateData.active = active;
    if (dollarRate !== undefined) updateData.dollarRate = dollarRate !== null ? String(dollarRate) : null;
    if (assignedCountries !== undefined) {
      updateData.assignedCountries = assignedCountries && Array.isArray(assignedCountries) ? assignedCountries : null;
    }

    const updatedBank = await prisma.remittanceBank.update({
      where: { id },
      data: updateData
    });

    if (assignedCountries !== undefined) {
      await syncBankToCountryServices(updatedBank);
    } else if (active !== undefined) {
      await syncBankToCountryServices(updatedBank);
    }

    // Format assignedCountries as array
    const formattedBank = {
      ...updatedBank,
      assignedCountries: updatedBank.assignedCountries ? (Array.isArray(updatedBank.assignedCountries) ? updatedBank.assignedCountries : []) : []
    };

    res.json({
      success: true,
      message: 'Remittance bank updated successfully',
      data: formattedBank
    });
  } catch (error) {
    console.error('Error updating remittance bank:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Remittance bank not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete remittance bank
export const deleteRemittanceBank = async (req, res) => {
  try {
    const { id } = req.params;

    const bank = await prisma.remittanceBank.findUnique({
      where: { id }
    });

    if (!bank) {
      return res.status(404).json({ 
        success: false, 
        message: 'Remittance bank not found' 
      });
    }

    await prisma.remittanceBank.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Remittance bank deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting remittance bank:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Remittance bank not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

function normalizeAccountNumber(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

async function lookupAccountHolderFromHistory({ bankId, accountNumber }) {
  const normalized = normalizeAccountNumber(accountNumber);
  if (!normalized) return null;

  const recent = await prisma.remittanceTransaction.findMany({
    where: {
      transferType: 'bank',
      status: { in: ['Completed', 'Processing', 'Hold', 'Manual_Review'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { recipientInfo: true },
  });

  for (const tx of recent) {
    const ri = tx.recipientInfo;
    if (!ri || typeof ri !== 'object') continue;
    const acc = normalizeAccountNumber(ri.accountNumber);
    if (acc !== normalized) continue;
    if (bankId && ri.bankId && ri.bankId !== bankId) continue;
    const name = String(ri.accountHolderName || ri.name || '').trim();
    if (name && name.toLowerCase() !== 'recipient') return name;
  }
  return null;
}

async function fetchExternalAccountVerification({ bank, accountNumber, countryId }) {
  const url = process.env.BANK_ACCOUNT_VERIFY_URL;
  if (!url) return null;

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.BANK_ACCOUNT_VERIFY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.BANK_ACCOUNT_VERIFY_API_KEY}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      bankId: bank.id,
      bankName: bank.name,
      accountNumber: normalizeAccountNumber(accountNumber),
      countryId: countryId || null,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || 'Account verification failed');
    err.status = response.status;
    throw err;
  }

  const name = String(
    data.accountHolderName || data.account_holder_name || data.name || ''
  ).trim();
  if (!name) return null;
  return name;
}

/** POST /api/remittance-banks/verify-account — resolve account holder name */
export const verifyBankAccount = async (req, res) => {
  try {
    const { bankId, accountNumber, countryId } = req.body || {};
    const normalized = normalizeAccountNumber(accountNumber);

    if (!bankId) {
      return res.status(400).json({ success: false, message: 'Bank is required' });
    }
    if (!normalized || normalized.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid account number (at least 5 digits)',
      });
    }

    const bank = await prisma.remittanceBank.findUnique({ where: { id: bankId } });
    if (!bank) {
      return res.status(404).json({ success: false, message: 'Bank not found' });
    }

    const fromHistory = await lookupAccountHolderFromHistory({ bankId, accountNumber: normalized });
    if (fromHistory) {
      return res.json({
        success: true,
        verified: true,
        source: 'history',
        accountHolderName: fromHistory,
        accountNumber: normalized,
        bankId: bank.id,
        bankName: bank.name,
      });
    }

    try {
      const externalName = await fetchExternalAccountVerification({
        bank,
        accountNumber: normalized,
        countryId,
      });
      if (externalName) {
        return res.json({
          success: true,
          verified: true,
          source: 'provider',
          accountHolderName: externalName,
          accountNumber: normalized,
          bankId: bank.id,
          bankName: bank.name,
        });
      }
    } catch (extErr) {
      console.error('[verifyBankAccount] external provider error:', extErr.message);
      return res.status(extErr.status || 502).json({
        success: false,
        message: extErr.message || 'Unable to verify account with bank',
      });
    }

    const allowMock =
      process.env.BANK_ACCOUNT_VERIFY_MOCK === 'true' ||
      process.env.NODE_ENV !== 'production';

    if (allowMock) {
      const demoNames = [
        'Ahmed Khan',
        'Fatima Ali',
        'Hassan Raza',
        'Ayesha Malik',
        'Usman Sheikh',
      ];
      const idx = parseInt(normalized.replace(/\D/g, '').slice(-4) || '0', 10) % demoNames.length;
      return res.json({
        success: true,
        verified: true,
        source: 'mock',
        accountHolderName: demoNames[idx],
        accountNumber: normalized,
        bankId: bank.id,
        bankName: bank.name,
      });
    }

    return res.status(404).json({
      success: false,
      verified: false,
      message: 'Account could not be verified. Check the number or enter the recipient name manually.',
    });
  } catch (error) {
    console.error('Error verifying bank account:', error);
    res.status(500).json({ success: false, message: error.message || 'Verification failed' });
  }
};

