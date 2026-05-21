import prisma from '../utils/prisma.js';

function parseAssignedCountries(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function countryMatchesAssignment(ac, country) {
  const iso2 = String(country.iso2 || '').toUpperCase();
  const iso3 = String(country.iso3 || '').toUpperCase();
  const cur =
    country.currencyCode != null
      ? String(country.currencyCode).trim().toUpperCase()
      : '';
  const code = ac?.countryCode != null ? String(ac.countryCode).trim().toUpperCase() : '';
  const name = ac?.country != null ? String(ac.country).trim() : '';
  return (
    code === iso2 ||
    code === iso3 ||
    (cur && code === cur) ||
    ac.countryCode === country.id ||
    name.toLowerCase() === String(country.name || '').trim().toLowerCase() ||
    name.toUpperCase() === iso2
  );
}

function resolveWalletDollarRate(wallet, country) {
  const assigned = parseAssignedCountries(wallet.assignedCountries);
  const row = assigned.find(
    (ac) =>
      countryMatchesAssignment(ac, country) &&
      String(ac?.status ?? 'Active').toLowerCase() === 'active'
  );
  if (row?.dollarPrice != null && String(row.dollarPrice).trim() !== '') {
    return String(row.dollarPrice);
  }
  return country.currencyRate != null ? String(country.currencyRate) : null;
}

// Get all remittance wallets
export const getAllRemittanceWallets = async (req, res) => {
  try {
    const { search, active } = req.query;

    const where = {};
    
    if (active !== undefined) {
      where.active = active === 'true';
    }
    
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const wallets = await prisma.remittanceWallet.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Format the response to include assignedCountries as array
    const formattedWallets = wallets.map(wallet => ({
      ...wallet,
      assignedCountries: wallet.assignedCountries ? (Array.isArray(wallet.assignedCountries) ? wallet.assignedCountries : []) : []
    }));

    res.json({ success: true, data: formattedWallets });
  } catch (error) {
    console.error('Error fetching remittance wallets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get remittance wallets by country
export const getWalletsByCountry = async (req, res) => {
  try {
    const { countryId } = req.params;

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

    const allWallets = await prisma.remittanceWallet.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });

    const walletsForCountry = allWallets.filter((wallet) => {
      const assigned = parseAssignedCountries(wallet.assignedCountries);
      if (!assigned.length) return true;
      return assigned.some(
        (ac) =>
          countryMatchesAssignment(ac, country) &&
          String(ac?.status ?? 'Active').toLowerCase() === 'active'
      );
    });

    const formattedWallets = walletsForCountry.map((wallet) => ({
      id: wallet.id,
      name: wallet.name,
      logo: wallet.logo,
      website: wallet.website,
      email: wallet.email,
      phoneNumber: wallet.phoneNumber,
      address: wallet.address,
      active: wallet.active,
      dollarRate: resolveWalletDollarRate(wallet, country),
      currencyCode: country.currencyCode || null,
      assignedCountries: parseAssignedCountries(wallet.assignedCountries),
    }));

    res.json({
      success: true,
      data: formattedWallets,
      country: {
        id: country.id,
        currencyCode: country.currencyCode || null,
        currencyRate: country.currencyRate || null,
      },
    });
  } catch (error) {
    console.error('Error fetching wallets by country:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/** GET /api/remittance-wallets/:walletId/gifts — gift rules for wallet sends (portal-driven). */
export const getWalletGiftRules = async (req, res) => {
  try {
    const { walletId } = req.params;
    if (!walletId) {
      return res.status(400).json({ success: false, message: 'Wallet ID is required' });
    }
    const wallet = await prisma.remittanceWallet.findUnique({
      where: { id: walletId },
      select: { id: true, active: true },
    });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }
    // Gift rules are stored per remittance bank in portal; wallet channel has no separate table yet.
    return res.json({ success: true, data: [] });
  } catch (error) {
    console.error('Error fetching wallet gift rules:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch gift rules' });
  }
};

// Get remittance wallet by ID
export const getRemittanceWalletById = async (req, res) => {
  try {
    const { id } = req.params;

    const wallet = await prisma.remittanceWallet.findUnique({
      where: { id }
    });

    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Remittance wallet not found' });
    }

    // Format assignedCountries as array
    const formattedWallet = {
      ...wallet,
      assignedCountries: wallet.assignedCountries ? (Array.isArray(wallet.assignedCountries) ? wallet.assignedCountries : []) : []
    };

    res.json({
      success: true,
      data: formattedWallet
    });
  } catch (error) {
    console.error('Error fetching remittance wallet:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new remittance wallet
export const createRemittanceWallet = async (req, res) => {
  try {
    const { name, logo, website, email, phoneNumber, address, active, assignedCountries } = req.body;

    if (!name || !website) {
      return res.status(400).json({ 
        success: false, 
        message: 'Wallet name and website are required' 
      });
    }

    const wallet = await prisma.remittanceWallet.create({
      data: {
        name: name.trim(),
        logo: logo || null,
        website: website.trim(),
        email: email?.trim() || null,
        phoneNumber: phoneNumber?.trim() || null,
        address: address?.trim() || null,
        active: active !== undefined ? active : true,
        assignedCountries: assignedCountries && Array.isArray(assignedCountries) ? assignedCountries : null
      }
    });

    // Format assignedCountries as array
    const formattedWallet = {
      ...wallet,
      assignedCountries: wallet.assignedCountries ? (Array.isArray(wallet.assignedCountries) ? wallet.assignedCountries : []) : []
    };

    res.status(201).json({
      success: true,
      message: 'Remittance wallet created successfully',
      data: formattedWallet
    });
  } catch (error) {
    console.error('Error creating remittance wallet:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update remittance wallet
export const updateRemittanceWallet = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, logo, website, email, phoneNumber, address, active, assignedCountries } = req.body;

    const wallet = await prisma.remittanceWallet.findUnique({
      where: { id }
    });

    if (!wallet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Remittance wallet not found' 
      });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (logo !== undefined) updateData.logo = logo || null;
    if (website !== undefined) updateData.website = website.trim();
    if (email !== undefined) updateData.email = email?.trim() || null;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber?.trim() || null;
    if (address !== undefined) updateData.address = address?.trim() || null;
    if (active !== undefined) updateData.active = active;
    if (assignedCountries !== undefined) {
      updateData.assignedCountries = assignedCountries && Array.isArray(assignedCountries) ? assignedCountries : null;
    }

    const updatedWallet = await prisma.remittanceWallet.update({
      where: { id },
      data: updateData
    });

    // Format assignedCountries as array
    const formattedWallet = {
      ...updatedWallet,
      assignedCountries: updatedWallet.assignedCountries ? (Array.isArray(updatedWallet.assignedCountries) ? updatedWallet.assignedCountries : []) : []
    };

    res.json({
      success: true,
      message: 'Remittance wallet updated successfully',
      data: formattedWallet
    });
  } catch (error) {
    console.error('Error updating remittance wallet:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Remittance wallet not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete remittance wallet
export const deleteRemittanceWallet = async (req, res) => {
  try {
    const { id } = req.params;

    const wallet = await prisma.remittanceWallet.findUnique({
      where: { id }
    });

    if (!wallet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Remittance wallet not found' 
      });
    }

    await prisma.remittanceWallet.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Remittance wallet deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting remittance wallet:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Remittance wallet not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

function normalizeWalletNumber(value) {
  return String(value || '').trim().replace(/\D/g, '');
}

async function lookupWalletHolderFromHistory({ walletId, accountNumber }) {
  const normalized = normalizeWalletNumber(accountNumber);
  if (!normalized) return null;

  const recent = await prisma.remittanceTransaction.findMany({
    where: {
      transferType: 'wallet',
      status: { in: ['Completed', 'Processing', 'Hold', 'Manual_Review'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { recipientInfo: true },
  });

  for (const tx of recent) {
    const ri = tx.recipientInfo;
    if (!ri || typeof ri !== 'object') continue;
    const acc = normalizeWalletNumber(ri.accountNumber || ri.phone);
    if (acc !== normalized) continue;
    const providerId = ri.walletId || ri.bankId;
    if (walletId && providerId && providerId !== walletId) continue;
    const name = String(ri.accountHolderName || ri.name || '').trim();
    if (name && !/^recipient$/i.test(name) && !/^wallet recipient$/i.test(name)) {
      return name;
    }
  }
  return null;
}

/** POST /api/remittance-wallets/verify-account — resolve wallet holder name (same flow as bank verify). */
export const verifyWalletAccount = async (req, res) => {
  try {
    const { walletId, accountNumber } = req.body || {};
    const normalized = normalizeWalletNumber(accountNumber);

    if (!walletId) {
      return res.status(400).json({ success: false, message: 'Wallet is required' });
    }
    if (!normalized || normalized.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid wallet number (at least 6 digits)',
      });
    }

    const wallet = await prisma.remittanceWallet.findUnique({ where: { id: walletId } });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    const fromHistory = await lookupWalletHolderFromHistory({
      walletId,
      accountNumber: normalized,
    });
    if (fromHistory) {
      return res.json({
        success: true,
        verified: true,
        source: 'history',
        accountHolderName: fromHistory,
        accountNumber: normalized,
        walletId: wallet.id,
        walletName: wallet.name,
        phone: normalized,
      });
    }

    const verifyUrl = process.env.WALLET_ACCOUNT_VERIFY_URL || process.env.BANK_ACCOUNT_VERIFY_URL;
    if (verifyUrl) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (process.env.WALLET_ACCOUNT_VERIFY_API_KEY || process.env.BANK_ACCOUNT_VERIFY_API_KEY) {
          headers.Authorization = `Bearer ${process.env.WALLET_ACCOUNT_VERIFY_API_KEY || process.env.BANK_ACCOUNT_VERIFY_API_KEY}`;
        }
        const response = await fetch(verifyUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            walletId: wallet.id,
            walletName: wallet.name,
            accountNumber: normalized,
            countryId: req.body?.countryId || null,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          const externalName = String(
            data.accountHolderName || data.account_holder_name || data.name || ''
          ).trim();
          if (externalName) {
            return res.json({
              success: true,
              verified: true,
              source: 'provider',
              accountHolderName: externalName,
              accountNumber: normalized,
              walletId: wallet.id,
              walletName: wallet.name,
              phone: String(data.phone || normalized),
            });
          }
        }
      } catch (extErr) {
        console.error('[verifyWalletAccount] external provider error:', extErr.message);
      }
    }

    const allowMock =
      process.env.WALLET_ACCOUNT_VERIFY_MOCK === 'true' ||
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
      const idx =
        parseInt(normalized.slice(-4) || '0', 10) % demoNames.length;
      return res.json({
        success: true,
        verified: true,
        source: 'mock',
        accountHolderName: demoNames[idx],
        accountNumber: normalized,
        walletId: wallet.id,
        walletName: wallet.name,
        phone: normalized,
      });
    }

    return res.status(404).json({
      success: false,
      verified: false,
      message:
        'Wallet number could not be verified. Check the number or try again.',
    });
  } catch (error) {
    console.error('Error verifying wallet account:', error);
    res.status(500).json({ success: false, message: error.message || 'Verification failed' });
  }
};

