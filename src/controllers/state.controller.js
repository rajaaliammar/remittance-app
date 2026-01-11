import prisma from '../utils/prisma.js';

// Get all states for a country
export const getCountryStates = async (req, res) => {
  try {
    const { countryId } = req.params;
    const { search, status } = req.query;

    const where = { countryId };
    
    if (status) {
      where.status = status;
    }
    
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const states = await prisma.state.findMany({
      where,
      include: {
        country: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: states });
  } catch (error) {
    console.error('Error fetching states:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get state by ID
export const getStateById = async (req, res) => {
  try {
    const { id } = req.params;

    const state = await prisma.state.findUnique({
      where: { id },
      include: {
        country: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!state) {
      return res.status(404).json({ success: false, message: 'State not found' });
    }

    res.json({
      success: true,
      data: state
    });
  } catch (error) {
    console.error('Error fetching state:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new state
export const createState = async (req, res) => {
  try {
    const { countryId, name, status } = req.body;

    if (!countryId || !name) {
      return res.status(400).json({ 
        success: false, 
        message: 'Country ID and name are required' 
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

    const state = await prisma.state.create({
      data: {
        countryId,
        name: name.trim(),
        status: status || 'Active'
      },
      include: {
        country: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'State created successfully',
      data: state
    });
  } catch (error) {
    console.error('Error creating state:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'State with this name already exists for this country' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update state
export const updateState = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const state = await prisma.state.findUnique({
      where: { id }
    });

    if (!state) {
      return res.status(404).json({ 
        success: false, 
        message: 'State not found' 
      });
    }

    // Check for duplicate name if name is being changed
    if (name && name.trim() !== state.name) {
      const existingState = await prisma.state.findFirst({
        where: {
          countryId: state.countryId,
          name: name.trim(),
          id: { not: id }
        }
      });

      if (existingState) {
        return res.status(409).json({ 
          success: false, 
          message: 'State with this name already exists for this country' 
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (status !== undefined) updateData.status = status;

    const updatedState = await prisma.state.update({
      where: { id },
      data: updateData,
      include: {
        country: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'State updated successfully',
      data: updatedState
    });
  } catch (error) {
    console.error('Error updating state:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'State not found' 
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ 
        success: false, 
        message: 'State with this name already exists for this country' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete state
export const deleteState = async (req, res) => {
  try {
    const { id } = req.params;

    const state = await prisma.state.findUnique({
      where: { id }
    });

    if (!state) {
      return res.status(404).json({ 
        success: false, 
        message: 'State not found' 
      });
    }

    await prisma.state.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'State deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting state:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ 
        success: false, 
        message: 'State not found' 
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Get country info for states page
export const getCountryInfoForStates = async (req, res) => {
  try {
    const { countryId } = req.params;

    const country = await prisma.country.findUnique({
      where: { id: countryId },
      select: {
        id: true,
        name: true
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









