import prisma from '../utils/prisma.js';
import {
  CacheKeys,
  REFERENCE_TTL_SECONDS,
  getOrSet,
  invalidateEmploymentStatusesCache,
} from '../utils/cache.js';

const DEFAULT_EMPLOYMENT_STATUSES = [
  'Employed full-time',
  'Self-employed',
  'Student',
  'Retired',
  'Unemployed',
  'Other',
];

async function ensureEmploymentStatusTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "employment_statuses" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'Active',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "employment_statuses_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "employment_statuses_name_key"
    ON "employment_statuses"("name");
  `);
}

async function seedDefaultEmploymentStatuses() {
  const count = await prisma.employmentStatus.count();
  if (count > 0) return;
  for (const name of DEFAULT_EMPLOYMENT_STATUSES) {
    await prisma.employmentStatus.create({
      data: { name, status: 'Active' },
    });
  }
}

export const getAllEmploymentStatuses = async (req, res) => {
  try {
    const { search, status } = req.query;
    const cacheKey = CacheKeys.employmentStatusesList({ search, status });

    const items = await getOrSet(cacheKey, REFERENCE_TTL_SECONDS, async () => {
      await ensureEmploymentStatusTable();
      await seedDefaultEmploymentStatuses();

      const where = {};
      if (status) where.status = status;
      if (search) where.name = { contains: search, mode: 'insensitive' };

      return prisma.employmentStatus.findMany({
        where,
        orderBy: { name: 'asc' },
      });
    });

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error fetching employment statuses:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getEmploymentStatusById = async (req, res) => {
  try {
    await ensureEmploymentStatusTable();
    const item = await prisma.employmentStatus.findUnique({
      where: { id: req.params.id },
    });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Employment status not found' });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Error fetching employment status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createEmploymentStatus = async (req, res) => {
  try {
    await ensureEmploymentStatusTable();
    const { name, status } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    const item = await prisma.employmentStatus.create({
      data: { name: name.trim(), status: status || 'Active' },
    });
    res.status(201).json({
      success: true,
      message: 'Employment status created successfully',
      data: item,
    });
    void invalidateEmploymentStatusesCache();
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Name already exists' });
    }
    console.error('Error creating employment status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateEmploymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;
    const existing = await prisma.employmentStatus.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Employment status not found' });
    }
    if (name && name.trim() !== existing.name) {
      const dup = await prisma.employmentStatus.findFirst({
        where: { name: name.trim(), id: { not: id } },
      });
      if (dup) {
        return res.status(409).json({ success: false, message: 'Name already exists' });
      }
    }
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (status !== undefined) updateData.status = status;
    const item = await prisma.employmentStatus.update({ where: { id }, data: updateData });
    res.json({
      success: true,
      message: 'Employment status updated successfully',
      data: item,
    });
    void invalidateEmploymentStatusesCache();
  } catch (error) {
    console.error('Error updating employment status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteEmploymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.employmentStatus.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Employment status not found' });
    }
    await prisma.employmentStatus.delete({ where: { id } });
    res.json({ success: true, message: 'Employment status deleted successfully' });
    void invalidateEmploymentStatusesCache();
  } catch (error) {
    console.error('Error deleting employment status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
