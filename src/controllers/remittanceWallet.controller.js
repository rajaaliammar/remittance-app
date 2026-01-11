import prisma from '../utils/prisma.js';

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
      select: { id: true, iso2: true, iso3: true, name: true }
    });

    if (!country) {
      return res.status(404).json({ 
        success: false, 
        message: 'Country not found' 
      });
    }

    // Get all active wallets
    const allWallets = await prisma.remittanceWallet.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' }
    });

    // Filter wallets that have this country in their assignedCountries
    const walletsForCountry = allWallets.filter(wallet => {
      if (!wallet.assignedCountries) return false;
      
      const assignedCountries = Array.isArray(wallet.assignedCountries) 
        ? wallet.assignedCountries 
        : [];
      
      // Check if country is assigned and status is Active
      // Match by countryCode (ISO2), countryId, or country name
      return assignedCountries.some(ac => {
        const matchesCountry = 
          ac.countryCode === country.iso2 || 
          ac.countryCode === country.iso3 ||
          ac.countryCode === country.id ||
          ac.country === country.name ||
          ac.country === country.iso2;
        
        return matchesCountry && ac.status === 'Active';
      });
    });

    // Format the response
    const formattedWallets = walletsForCountry.map(wallet => ({
      id: wallet.id,
      name: wallet.name,
      logo: wallet.logo,
      website: wallet.website,
      email: wallet.email,
      phoneNumber: wallet.phoneNumber,
      address: wallet.address,
      active: wallet.active,
      assignedCountries: wallet.assignedCountries ? (Array.isArray(wallet.assignedCountries) ? wallet.assignedCountries : []) : []
    }));

    res.json({ success: true, data: formattedWallets });
  } catch (error) {
    console.error('Error fetching wallets by country:', error);
    res.status(500).json({ success: false, error: error.message });
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




