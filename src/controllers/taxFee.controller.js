import prisma from '../utils/prisma.js';

export const getAllTaxFees = async (req, res) => {
  try {
    const { search, status, type } = req.query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    const items = await prisma.taxFee.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        countries: {
          include: { country: { select: { id: true, name: true, iso2: true, iso3: true } } },
        },
      },
    });
    const data = items.map((item) => ({
      ...item,
      countries: item.countries?.map((tc) => tc.country) ?? [],
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching tax/fees:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getTaxFeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prisma.taxFee.findUnique({
      where: { id },
      include: {
        countries: {
          include: { country: { select: { id: true, name: true, iso2: true, iso3: true } } },
        },
      },
    });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Tax/Fee not found' });
    }
    const data = {
      ...item,
      countries: item.countries?.map((tc) => tc.country) ?? [],
    };
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching tax/fee:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const createTaxFee = async (req, res) => {
  try {
    const { name, type, valueType, value, description, status, countryIds, transferType } = req.body;
    if (!name || !type || !valueType || value == null || value === '') {
      return res.status(400).json({
        success: false,
        message: 'Name, type, valueType and value are required',
      });
    }
    if (!['Tax', 'Fee'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be Tax or Fee' });
    }
    if (!['percentage', 'fixed'].includes(valueType)) {
      return res.status(400).json({ success: false, message: 'valueType must be percentage or fixed' });
    }
    const validTransferType = ['wallet', 'bank', 'both'].includes(transferType) ? transferType : 'both';
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      return res.status(400).json({ success: false, message: 'Value must be a non-negative number' });
    }
    const ids = Array.isArray(countryIds) ? countryIds.filter(Boolean) : [];
    const item = await prisma.taxFee.create({
      data: {
        name: name.trim(),
        type,
        valueType,
        value: numValue,
        transferType: validTransferType,
        description: description?.trim() || null,
        status: status || 'Active',
        ...(ids.length > 0 && {
          countries: {
            create: ids.map((countryId) => ({ countryId })),
          },
        }),
      },
      include: {
        countries: {
          include: { country: { select: { id: true, name: true, iso2: true, iso3: true } } },
        },
      },
    });
    const data = {
      ...item,
      countries: item.countries?.map((tc) => tc.country) ?? [],
    };
    res.status(201).json({
      success: true,
      message: 'Tax/Fee created successfully',
      data,
    });
  } catch (error) {
    console.error('Error creating tax/fee:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateTaxFee = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, valueType, value, description, status, countryIds } = req.body;
    const existing = await prisma.taxFee.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Tax/Fee not found' });
    }
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (type !== undefined) {
      if (!['Tax', 'Fee'].includes(type)) {
        return res.status(400).json({ success: false, message: 'Type must be Tax or Fee' });
      }
      updateData.type = type;
    }
    if (valueType !== undefined) {
      if (!['percentage', 'fixed'].includes(valueType)) {
        return res.status(400).json({ success: false, message: 'valueType must be percentage or fixed' });
      }
      updateData.valueType = valueType;
    }
    if (value !== undefined && value !== null && value !== '') {
      const numValue = parseFloat(value);
      if (isNaN(numValue) || numValue < 0) {
        return res.status(400).json({ success: false, message: 'Value must be a non-negative number' });
      }
      updateData.value = numValue;
    }
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (status !== undefined) updateData.status = status;

    await prisma.taxFee.update({ where: { id }, data: updateData });

    const ids = Array.isArray(countryIds) ? countryIds.filter(Boolean) : [];
    await prisma.taxFeeCountry.deleteMany({ where: { taxFeeId: id } });
    if (ids.length > 0) {
      await prisma.taxFeeCountry.createMany({
        data: ids.map((countryId) => ({ taxFeeId: id, countryId })),
      });
    }

    const item = await prisma.taxFee.findUnique({
      where: { id },
      include: {
        countries: {
          include: { country: { select: { id: true, name: true, iso2: true, iso3: true } } },
        },
      },
    });
    const data = {
      ...item,
      countries: item.countries?.map((tc) => tc.country) ?? [],
    };
    res.json({
      success: true,
      message: 'Tax/Fee updated successfully',
      data,
    });
  } catch (error) {
    console.error('Error updating tax/fee:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Tax/Fee not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

export const deleteTaxFee = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.taxFee.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Tax/Fee not found' });
    }
    await prisma.taxFee.delete({ where: { id } });
    res.json({ success: true, message: 'Tax/Fee deleted successfully' });
  } catch (error) {
    console.error('Error deleting tax/fee:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Tax/Fee not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};
