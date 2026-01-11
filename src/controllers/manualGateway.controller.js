import prisma from '../utils/prisma.js';

// Get all manual gateways
export const getAllManualGateways = async (req, res) => {
  try {
    const { search, status } = req.query;

    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const gateways = await prisma.manualGateway.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: gateways });
  } catch (error) {
    console.error('Error fetching manual gateways:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get manual gateway by ID
export const getManualGatewayById = async (req, res) => {
  try {
    const { id } = req.params;

    const gateway = await prisma.manualGateway.findUnique({
      where: { id }
    });

    if (!gateway) {
      return res.status(404).json({ 
        success: false, 
        message: 'Manual gateway not found' 
      });
    }

    res.json({ success: true, data: gateway });
  } catch (error) {
    console.error('Error fetching manual gateway:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create manual gateway
export const createManualGateway = async (req, res) => {
  try {
    const {
      name,
      logo,
      logoColor,
      supportedCurrency,
      description,
      status,
      paymentFields,
      paymentDescription,
      currencyConfigs
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    const gateway = await prisma.manualGateway.create({
      data: {
        name,
        logo: logo || null,
        logoColor: logoColor || null,
        supportedCurrency: supportedCurrency ? parseInt(supportedCurrency) : null,
        description: description || null,
        status: status || 'Active',
        paymentFields: paymentFields || null,
        paymentDescription: paymentDescription || null,
        currencyConfigs: currencyConfigs || null
      }
    });

    res.status(201).json({ success: true, data: gateway });
  } catch (error) {
    console.error('Error creating manual gateway:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update manual gateway
export const updateManualGateway = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      logo,
      logoColor,
      supportedCurrency,
      description,
      status,
      paymentFields,
      paymentDescription,
      currencyConfigs
    } = req.body;

    const gateway = await prisma.manualGateway.findUnique({
      where: { id }
    });

    if (!gateway) {
      return res.status(404).json({
        success: false,
        message: 'Manual gateway not found'
      });
    }

    const updatedGateway = await prisma.manualGateway.update({
      where: { id },
      data: {
        name: name !== undefined ? name : gateway.name,
        logo: logo !== undefined ? logo : gateway.logo,
        logoColor: logoColor !== undefined ? logoColor : gateway.logoColor,
        supportedCurrency: supportedCurrency !== undefined ? parseInt(supportedCurrency) : gateway.supportedCurrency,
        description: description !== undefined ? description : gateway.description,
        status: status !== undefined ? status : gateway.status,
        paymentFields: paymentFields !== undefined ? paymentFields : gateway.paymentFields,
        paymentDescription: paymentDescription !== undefined ? paymentDescription : gateway.paymentDescription,
        currencyConfigs: currencyConfigs !== undefined ? currencyConfigs : gateway.currencyConfigs
      }
    });

    res.json({ success: true, data: updatedGateway });
  } catch (error) {
    console.error('Error updating manual gateway:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete manual gateway
export const deleteManualGateway = async (req, res) => {
  try {
    const { id } = req.params;

    const gateway = await prisma.manualGateway.findUnique({
      where: { id }
    });

    if (!gateway) {
      return res.status(404).json({
        success: false,
        message: 'Manual gateway not found'
      });
    }

    await prisma.manualGateway.delete({
      where: { id }
    });

    res.json({ success: true, message: 'Manual gateway deleted successfully' });
  } catch (error) {
    console.error('Error deleting manual gateway:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

