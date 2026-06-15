import prisma from '../utils/prisma.js';
import {
  CacheKeys,
  REFERENCE_TTL_SECONDS,
  getOrSet,
  invalidateLevelsCache,
} from '../utils/cache.js';

// Get all levels (ordered by priority)
export const getLevels = async (req, res) => {
  try {
    const levels = await getOrSet(CacheKeys.levelsList(), REFERENCE_TTL_SECONDS, () =>
      prisma.level.findMany({
        orderBy: { priority: 'asc' },
      }),
    );
    res.json({ success: true, data: levels });
  } catch (error) {
    console.error('Error fetching levels:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get level by ID
export const getLevelById = async (req, res) => {
  try {
    const { id } = req.params;
    const level = await prisma.level.findUnique({
      where: { id }
    });
    if (!level) {
      return res.status(404).json({ success: false, message: 'Level not found' });
    }
    res.json({ success: true, data: level });
  } catch (error) {
    console.error('Error fetching level:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create level
export const createLevel = async (req, res) => {
  try {
    const { name, priority, description, active, transactionLimits, kycRequirements } = req.body || {};

    if (!name || priority === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Name and priority are required'
      });
    }

    // Ensure JSON fields are plain values Prisma can store (no undefined)
    const txLimits =
      transactionLimits != null && (Array.isArray(transactionLimits) || typeof transactionLimits === 'object')
        ? transactionLimits
        : null;
    const kycReq =
      kycRequirements != null && typeof kycRequirements === 'object' && !Array.isArray(kycRequirements)
        ? kycRequirements
        : null;

    const level = await prisma.level.create({
      data: {
        name: String(name),
        priority: Number(priority),
        description: description != null && description !== '' ? String(description) : null,
        active: active !== false,
        transactionLimits: txLimits,
        kycRequirements: kycReq
      }
    });

    res.status(201).json({ success: true, data: level });
    void invalidateLevelsCache();
  } catch (error) {
    console.error('Error creating level:', error);
    console.error('Level create stack:', error?.stack);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code || undefined
    });
  }
};

// Update level
export const updateLevel = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, priority, description, active, transactionLimits, kycRequirements } = req.body;

    const existing = await prisma.level.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Level not found' });
    }

    const level = await prisma.level.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: String(name) }),
        ...(priority !== undefined && { priority: Number(priority) }),
        ...(description !== undefined && { description: description || null }),
        ...(active !== undefined && { active: Boolean(active) }),
        ...(transactionLimits !== undefined && { transactionLimits }),
        ...(kycRequirements !== undefined && { kycRequirements })
      }
    });

    res.json({ success: true, data: level });
    void invalidateLevelsCache();
  } catch (error) {
    console.error('Error updating level:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete level
export const deleteLevel = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.level.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Level not found' });
    }

    await prisma.level.delete({ where: { id } });
    res.json({ success: true, message: 'Level deleted' });
    void invalidateLevelsCache();
  } catch (error) {
    console.error('Error deleting level:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
