import prisma from '../utils/prisma.js';

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

    if (!countryId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Country ID is required' 
      });
    }

    // Get the country to find its ISO2 code
    const country = await prisma.country.findUnique({
      where: { id: countryId },
      select: { id: true, iso2: true, iso3: true, name: true, currencyCode: true },
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

    // Format the response
    const formattedBanks = banksForCountry.map(bank => ({
      id: bank.id,
      name: bank.name,
      logo: serviceImagesByBankId.get(bank.id) || bank.logo,
      website: bank.website,
      email: bank.email,
      phoneNumber: bank.phoneNumber,
      address: bank.address,
      active: bank.active,
      dollarRate: bank.dollarRate,
      assignedCountries: bank.assignedCountries ? (Array.isArray(bank.assignedCountries) ? bank.assignedCountries : []) : []
    }));

    res.json({ success: true, data: formattedBanks });
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
        logo: logo || null,
        website: website.trim(),
        email: email?.trim() || null,
        phoneNumber: phoneNumber?.trim() || null,
        address: address?.trim() || null,
        active: active !== undefined ? active : true,
        dollarRate: dollarRate !== undefined && dollarRate !== null ? String(dollarRate) : null,
        assignedCountries: assignedCountries && Array.isArray(assignedCountries) ? assignedCountries : null
      }
    });

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
    if (logo !== undefined) updateData.logo = logo || null;
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




