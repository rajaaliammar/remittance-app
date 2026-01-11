import prisma from '../utils/prisma.js';

// Get all services
export const getAllServices = async (req, res) => {
  try {
    const { search, status } = req.query;

    const where = {};
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const services = await prisma.service.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: services });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get service by ID
export const getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await prisma.service.findUnique({
      where: { id }
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
    const { name, status } = req.body;

    if (!name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Service name is required' 
      });
    }

    const service = await prisma.service.create({
      data: {
        name: name.trim(),
        status: status || 'Active'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: service
    });
  } catch (error) {
    console.error('Error creating service:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Service with this name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update service
export const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const service = await prisma.service.findUnique({
      where: { id }
    });

    if (!service) {
      return res.status(404).json({ 
        success: false, 
        message: 'Service not found' 
      });
    }

    // Check for duplicate name if name is being changed
    if (name && name.trim() !== service.name) {
      const existingService = await prisma.service.findFirst({
        where: {
          name: name.trim(),
          id: { not: id }
        }
      });

      if (existingService) {
        return res.status(409).json({ 
          success: false, 
          message: 'Service with this name already exists' 
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (status !== undefined) updateData.status = status;

    const updatedService = await prisma.service.update({
      where: { id },
      data: updateData
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
        message: 'Service not found' 
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'Service with this name already exists' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete service
export const deleteService = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await prisma.service.findUnique({
      where: { id }
    });

    if (!service) {
      return res.status(404).json({ 
        success: false, 
        message: 'Service not found' 
      });
    }

    await prisma.service.delete({
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








