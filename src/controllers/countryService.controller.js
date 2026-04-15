import prisma from '../utils/prisma.js';

// Get all services for a country
export const getCountryServices = async (req, res) => {
  try {
    const { countryId } = req.params;
    const { search, serviceType, status } = req.query;

    const where = { countryId };
    
    if (status) {
      where.status = status;
    }
    
    if (serviceType) {
      where.serviceType = serviceType;
    }
    
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const services = await prisma.countryService.findMany({
      where,
      include: {
        country: {
          select: {
            id: true,
            name: true,
            currencyName: true,
            currencyCode: true
          }
        },
        remittanceBank: {
          select: {
            id: true,
            name: true,
            dollarRate: true,
            assignedCountries: true,
            logo: true,
            website: true,
          }
        },
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: services });
  } catch (error) {
    console.error('Error fetching country services:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get service by ID
export const getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await prisma.countryService.findUnique({
      where: { id },
      include: {
        country: {
          select: {
            id: true,
            name: true,
            currencyName: true,
            currencyCode: true
          }
        },
        remittanceBank: {
          select: {
            id: true,
            name: true,
            dollarRate: true,
            assignedCountries: true,
            logo: true,
            website: true,
          }
        },
      }
    });

    if (!service) {
      return res.status(404).json({ success: false, message: 'Service not found' });
    }

    res.json({
      success: true,
      data: service
    });
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new service
export const createService = async (req, res) => {
  try {
    const {
      countryId,
      name,
      serviceType,
      minAmount,
      maxAmount,
      status,
      serviceTypeMode,
      fields,
      remittanceBankId,
      displayImage,
    } = req.body;

    if (!countryId || !name || !serviceType) {
      return res.status(400).json({ 
        success: false, 
        message: 'Country ID, name, and service type are required' 
      });
    }

    // Validate service type
    const validServiceTypes = ['Airtime', 'Cash Pick-up', 'Bank Transfer'];
    if (!validServiceTypes.includes(serviceType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid service type. Must be one of: Airtime, Cash Pick-up, Bank Transfer' 
      });
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

    const service = await prisma.countryService.create({
      data: {
        countryId,
        name: name.trim(),
        serviceType,
        minAmount: minAmount || null,
        maxAmount: maxAmount || null,
        status: status || 'Active',
        serviceTypeMode: serviceTypeMode || 'Automatic',
        fields: fields || null,
        remittanceBankId: remittanceBankId || null,
        displayImage: displayImage && String(displayImage).trim() ? String(displayImage).trim() : null,
      },
      include: {
        country: {
          select: {
            id: true,
            name: true,
            currencyName: true,
            currencyCode: true
          }
        },
        remittanceBank: {
          select: {
            id: true,
            name: true,
            dollarRate: true,
            assignedCountries: true,
          }
        },
      }
    });

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: service
    });
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update service
export const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      serviceType,
      minAmount,
      maxAmount,
      status,
      serviceTypeMode,
      fields,
      remittanceBankId,
      displayImage,
    } = req.body;

    const service = await prisma.countryService.findUnique({
      where: { id }
    });

    if (!service) {
      return res.status(404).json({ 
        success: false, 
        message: 'Service not found' 
      });
    }

    // Validate service type if being updated
    if (serviceType) {
      const validServiceTypes = ['Airtime', 'Cash Pick-up', 'Bank Transfer'];
      if (!validServiceTypes.includes(serviceType)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid service type. Must be one of: Airtime, Cash Pick-up, Bank Transfer' 
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (serviceType !== undefined) updateData.serviceType = serviceType;
    if (minAmount !== undefined) updateData.minAmount = minAmount;
    if (maxAmount !== undefined) updateData.maxAmount = maxAmount;
    if (status !== undefined) updateData.status = status;
    if (serviceTypeMode !== undefined) updateData.serviceTypeMode = serviceTypeMode;
    if (fields !== undefined) updateData.fields = fields;
    if (remittanceBankId !== undefined) updateData.remittanceBankId = remittanceBankId || null;
    if (displayImage !== undefined) {
      updateData.displayImage =
        displayImage && String(displayImage).trim() ? String(displayImage).trim() : null;
    }

    const updatedService = await prisma.countryService.update({
      where: { id },
      data: updateData,
      include: {
        country: {
          select: {
            id: true,
            name: true,
            currencyName: true,
            currencyCode: true
          }
        },
        remittanceBank: {
          select: {
            id: true,
            name: true,
            dollarRate: true,
            assignedCountries: true,
          }
        },
      }
    });

    res.json({
      success: true,
      message: 'Service updated successfully',
      data: updatedService
    });
  } catch (error) {
    console.error('Error updating service:', error);

    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Service not found',
      });
    }

    // Common after schema change: DB missing `displayImage` — run `npx prisma migrate deploy` or `db push`
    const hint =
      String(error.message || '').includes('displayImage') ||
      String(error.message || '').includes('Unknown arg') ||
      String(error.meta?.column_name || '') === 'displayImage'
        ? 'Database may be missing column country_services.displayImage. Run: npx prisma migrate deploy (from Remittance_backend)'
        : undefined;

    res.status(500).json({
      success: false,
      error: error.message,
      ...(hint && { hint }),
      ...(error.code && { code: error.code }),
    });
  }
};

// Delete service
export const deleteService = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await prisma.countryService.findUnique({
      where: { id }
    });

    if (!service) {
      return res.status(404).json({ 
        success: false, 
        message: 'Service not found' 
      });
    }

    await prisma.countryService.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting service:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Service not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Get country info for services page
export const getCountryInfo = async (req, res) => {
  try {
    const { countryId } = req.params;

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

    res.json({
      success: true,
      data: country
    });
  } catch (error) {
    console.error('Error fetching country info:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};









