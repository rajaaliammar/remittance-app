import prisma from '../utils/prisma.js';

const DEFAULT_SOURCE_OF_FUNDS = [
  'Salary or wages',
  'Business income',
  'Investments',
  'Gift or inheritance',
  'Savings',
  'Other',
];

async function seedDefaultSourceOfFunds() {
  const count = await prisma.sourceOfFund.count();
  if (count > 0) return;
  for (const name of DEFAULT_SOURCE_OF_FUNDS) {
    await prisma.sourceOfFund.create({ data: { name, status: 'Active' } });
  }
}

// Get all source of funds
export const getAllSourceOfFunds = async (req, res) => {
  try {
    await seedDefaultSourceOfFunds();

    const { search, status } = req.query;

    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const sourceOfFunds = await prisma.sourceOfFund.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: sourceOfFunds });
  } catch (error) {
    console.error('Error fetching source of funds:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get source of fund by ID
export const getSourceOfFundById = async (req, res) => {
  try {
    const { id } = req.params;

    const sourceOfFund = await prisma.sourceOfFund.findUnique({
      where: { id }
    });

    if (!sourceOfFund) {
      return res.status(404).json({ success: false, message: 'Source of fund not found' });
    }

    res.json({
      success: true,
      data: sourceOfFund
    });
  } catch (error) {
    console.error('Error fetching source of fund:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new source of fund
export const createSourceOfFund = async (req, res) => {
  try {
    const { name, status } = req.body;

    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Source of fund name is required' 
      });
    }

    const sourceOfFund = await prisma.sourceOfFund.create({
      data: {
        name: name.trim(),
        status: status || 'Active'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Source of fund created successfully',
      data: sourceOfFund
    });
  } catch (error) {
    console.error('Error creating source of fund:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Source of fund with this name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update source of fund
export const updateSourceOfFund = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const sourceOfFund = await prisma.sourceOfFund.findUnique({
      where: { id }
    });

    if (!sourceOfFund) {
      return res.status(404).json({ 
        success: false, 
        message: 'Source of fund not found' 
      });
    }

    // Check for duplicate name if name is being changed
    if (name && name.trim() !== sourceOfFund.name) {
      const existingSourceOfFund = await prisma.sourceOfFund.findFirst({
        where: {
          name: name.trim(),
          id: { not: id }
        }
      });

      if (existingSourceOfFund) {
        return res.status(409).json({ 
          success: false, 
          message: 'Source of fund with this name already exists' 
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (status !== undefined) updateData.status = status;

    const updatedSourceOfFund = await prisma.sourceOfFund.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Source of fund updated successfully',
      data: updatedSourceOfFund
    });
  } catch (error) {
    console.error('Error updating source of fund:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Source of fund not found' 
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Source of fund with this name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete source of fund
export const deleteSourceOfFund = async (req, res) => {
  try {
    const { id } = req.params;

    const sourceOfFund = await prisma.sourceOfFund.findUnique({
      where: { id }
    });

    if (!sourceOfFund) {
      return res.status(404).json({ 
        success: false, 
        message: 'Source of fund not found' 
      });
    }

    await prisma.sourceOfFund.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Source of fund deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting source of fund:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Source of fund not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};








