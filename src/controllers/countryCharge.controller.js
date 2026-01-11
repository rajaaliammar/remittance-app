import prisma from '../utils/prisma.js';

// Get charges for a country
export const getCountryCharges = async (req, res) => {
  try {
    const { countryId } = req.params;

    let charges = await prisma.countryCharge.findUnique({
      where: { countryId },
      include: {
        country: {
          select: {
            id: true,
            name: true,
            currencyName: true,
            currencyCode: true
          }
        }
      }
    });

    // If no charges exist, create default structure
    if (!charges) {
      const country = await prisma.country.findUnique({
        where: { id: countryId },
        select: {
          id: true,
          name: true,
          currencyName: true,
          currencyCode: true
        }
      });

      if (!country) {
        return res.status(404).json({ 
          success: false, 
          message: 'Country not found' 
        });
      }

      // Return default structure
      return res.json({
        success: true,
        data: {
          countryId,
          chargeLevels: [],
          country
        }
      });
    }

    res.json({ success: true, data: charges });
  } catch (error) {
    console.error('Error fetching country charges:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create or update charges for a country
export const upsertCountryCharges = async (req, res) => {
  try {
    const { countryId } = req.params;
    const { chargeLevels } = req.body;

    if (!countryId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Country ID is required' 
      });
    }

    // Validate charge levels
    if (!Array.isArray(chargeLevels)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Charge levels must be an array' 
      });
    }

    // Validate each level
    for (const level of chargeLevels) {
      if (!level.level || !level.type || level.amount === undefined || level.charge === undefined) {
        return res.status(400).json({ 
          success: false, 
          message: 'Each charge level must have level, type, amount, and charge fields' 
        });
      }
      if (!['fixed', 'percent'].includes(level.type)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Charge type must be either "fixed" or "percent"' 
        });
      }
    }

    // Check if country exists
    const country = await prisma.country.findUnique({
      where: { id: countryId }
    });

    if (!country) {
      return res.status(404).json({ 
        success: false, 
        message: 'Country not found' 
      });
    }

    // Upsert charges (create if doesn't exist, update if exists)
    const charges = await prisma.countryCharge.upsert({
      where: { countryId },
      update: {
        chargeLevels: chargeLevels
      },
      create: {
        countryId,
        chargeLevels: chargeLevels
      },
      include: {
        country: {
          select: {
            id: true,
            name: true,
            currencyName: true,
            currencyCode: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Charges saved successfully',
      data: charges
    });
  } catch (error) {
    console.error('Error saving country charges:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Charges already exist for this country' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete charges for a country
export const deleteCountryCharges = async (req, res) => {
  try {
    const { countryId } = req.params;

    const charges = await prisma.countryCharge.findUnique({
      where: { countryId }
    });

    if (!charges) {
      return res.status(404).json({ 
        success: false, 
        message: 'Charges not found' 
      });
    }

    await prisma.countryCharge.delete({
      where: { countryId }
    });

    res.json({
      success: true,
      message: 'Charges deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting country charges:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Charges not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};









