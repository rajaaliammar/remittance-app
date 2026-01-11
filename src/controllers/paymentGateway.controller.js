import prisma from '../utils/prisma.js';

// Get all payment gateways
export const getAllPaymentGateways = async (req, res) => {
  try {
    const { search, status } = req.query;

    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const gateways = await prisma.paymentGateway.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: gateways });
  } catch (error) {
    console.error('Error fetching payment gateways:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get payment gateway by ID
export const getPaymentGatewayById = async (req, res) => {
  try {
    const { id } = req.params;

    const gateway = await prisma.paymentGateway.findUnique({
      where: { id }
    });

    if (!gateway) {
      return res.status(404).json({ 
        success: false, 
        message: 'Payment gateway not found' 
      });
    }

    res.json({ success: true, data: gateway });
  } catch (error) {
    console.error('Error fetching payment gateway:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create payment gateway
export const createPaymentGateway = async (req, res) => {
  try {
    const {
      name,
      logo,
      logoColor,
      gatewayCurrencies,
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

    const gateway = await prisma.paymentGateway.create({
      data: {
        name,
        logo: logo || null,
        logoColor: logoColor || null,
        gatewayCurrencies: gatewayCurrencies ? parseInt(gatewayCurrencies) : null,
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
    console.error('Error creating payment gateway:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update payment gateway
export const updatePaymentGateway = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      logo,
      logoColor,
      gatewayCurrencies,
      supportedCurrency,
      description,
      status,
      paymentFields,
      paymentDescription,
      currencyConfigs
    } = req.body;

    const gateway = await prisma.paymentGateway.findUnique({
      where: { id }
    });

    if (!gateway) {
      return res.status(404).json({
        success: false,
        message: 'Payment gateway not found'
      });
    }

    const updatedGateway = await prisma.paymentGateway.update({
      where: { id },
      data: {
        name: name !== undefined ? name : gateway.name,
        logo: logo !== undefined ? logo : gateway.logo,
        logoColor: logoColor !== undefined ? logoColor : gateway.logoColor,
        gatewayCurrencies: gatewayCurrencies !== undefined ? parseInt(gatewayCurrencies) : gateway.gatewayCurrencies,
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
    console.error('Error updating payment gateway:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete payment gateway
export const deletePaymentGateway = async (req, res) => {
  try {
    const { id } = req.params;

    const gateway = await prisma.paymentGateway.findUnique({
      where: { id }
    });

    if (!gateway) {
      return res.status(404).json({
        success: false,
        message: 'Payment gateway not found'
      });
    }

    await prisma.paymentGateway.delete({
      where: { id }
    });

    res.json({ success: true, message: 'Payment gateway deleted successfully' });
  } catch (error) {
    console.error('Error deleting payment gateway:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

