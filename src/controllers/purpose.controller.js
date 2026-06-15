import prisma from '../utils/prisma.js';
import {
  CacheKeys,
  REFERENCE_TTL_SECONDS,
  getOrSet,
  invalidatePurposesCache,
} from '../utils/cache.js';

// Get all purposes
export const getAllPurposes = async (req, res) => {
  try {
    const { search, status } = req.query;
    const cacheKey = CacheKeys.purposesList({ search, status });

    const purposes = await getOrSet(cacheKey, REFERENCE_TTL_SECONDS, async () => {
      const where = {};
      if (status) {
        where.status = status;
      }
      if (search) {
        where.name = { contains: search, mode: 'insensitive' };
      }
      return prisma.purpose.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    });

    res.json({ success: true, data: purposes });
  } catch (error) {
    console.error('Error fetching purposes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get purpose by ID
export const getPurposeById = async (req, res) => {
  try {
    const { id } = req.params;

    const purpose = await prisma.purpose.findUnique({
      where: { id }
    });

    if (!purpose) {
      return res.status(404).json({ success: false, message: 'Purpose not found' });
    }

    res.json({
      success: true,
      data: purpose
    });
  } catch (error) {
    console.error('Error fetching purpose:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new purpose
export const createPurpose = async (req, res) => {
  try {
    const { name, status } = req.body;

    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Purpose name is required' 
      });
    }

    const purpose = await prisma.purpose.create({
      data: {
        name: name.trim(),
        status: status || 'Active'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Purpose created successfully',
      data: purpose
    });
    void invalidatePurposesCache();
  } catch (error) {
    console.error('Error creating purpose:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Purpose with this name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update purpose
export const updatePurpose = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const purpose = await prisma.purpose.findUnique({
      where: { id }
    });

    if (!purpose) {
      return res.status(404).json({ 
        success: false, 
        message: 'Purpose not found' 
      });
    }

    // Check for duplicate name if name is being changed
    if (name && name.trim() !== purpose.name) {
      const existingPurpose = await prisma.purpose.findFirst({
        where: {
          name: name.trim(),
          id: { not: id }
        }
      });

      if (existingPurpose) {
        return res.status(409).json({ 
          success: false, 
          message: 'Purpose with this name already exists' 
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (status !== undefined) updateData.status = status;

    const updatedPurpose = await prisma.purpose.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Purpose updated successfully',
      data: updatedPurpose
    });
    void invalidatePurposesCache();
  } catch (error) {
    console.error('Error updating purpose:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Purpose not found' 
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Purpose with this name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete purpose
export const deletePurpose = async (req, res) => {
  try {
    const { id } = req.params;

    const purpose = await prisma.purpose.findUnique({
      where: { id }
    });

    if (!purpose) {
      return res.status(404).json({ 
        success: false, 
        message: 'Purpose not found' 
      });
    }

    await prisma.purpose.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Purpose deleted successfully',
    });
    void invalidatePurposesCache();
  } catch (error) {
    console.error('Error deleting purpose:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'Purpose not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};








