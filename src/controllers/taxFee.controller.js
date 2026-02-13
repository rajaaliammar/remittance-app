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
    const { name, type, valueType, value, tiers, applyTo, description, status, countryIds } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!type || !['Tax', 'Fee'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be Tax or Fee' });
    }
    if (!valueType || !['percentage', 'fixed', 'dynamic'].includes(valueType)) {
      return res.status(400).json({ success: false, message: 'Value type must be percentage, fixed or dynamic' });
    }
    const channel = (applyTo && ['bank', 'wallet', 'both'].includes(applyTo)) ? applyTo : 'both';

    let numValue = null;
    let tiersData = null;

    if (valueType === 'dynamic') {
      if (!Array.isArray(tiers) || tiers.length === 0) {
        return res.status(400).json({ success: false, message: 'Dynamic tax requires at least one tier (minAmount, maxAmount, valueType, value)' });
      }
      try {
        tiersData = tiers.map((t) => {
          const minA = parseFloat(t.minAmount);
          const maxA = parseFloat(t.maxAmount);
          const v = parseFloat(t.value);
          const vt = t.valueType === 'fixed' ? 'fixed' : 'percentage';
          if (isNaN(minA) || minA < 0 || isNaN(maxA) || maxA < 0 || isNaN(v) || v < 0) {
            throw new Error('Invalid tier: minAmount, maxAmount and value must be non-negative numbers');
          }
          return { minAmount: minA, maxAmount: maxA, valueType: vt, value: v };
        });
      } catch (err) {
        return res.status(400).json({ success: false, message: err.message || 'Invalid tier data' });
      }
    } else {
      if (value == null || value === '') {
        return res.status(400).json({ success: false, message: 'Value is required for percentage or fixed' });
      }
      numValue = parseFloat(value);
      if (isNaN(numValue) || numValue < 0) {
        return res.status(400).json({ success: false, message: 'Value must be a non-negative number' });
      }
    }

    const ids = Array.isArray(countryIds) ? countryIds.filter(Boolean) : [];
    const createData = {
      name: name.trim(),
      type,
      valueType,
      applyTo: channel,
      description: description?.trim() || null,
      status: status || 'Active',
      ...(ids.length > 0 && {
        countries: {
          create: ids.map((countryId) => ({ countryId })),
        },
      }),
    };
    if (valueType === 'dynamic') {
      createData.tiers = tiersData;
      createData.value = null;
    } else {
      createData.value = numValue;
      createData.tiers = null;
    }
    const item = await prisma.taxFee.create({
      data: createData,
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
    const msg = error.message || '';
    if (msg.includes('Unknown arg') || msg.includes('Unknown field') || msg.includes('column') || msg.includes('applyTo') || msg.includes('tiers')) {
      return res.status(500).json({
        success: false,
        message: 'Database schema may be outdated. Run in Remittance_backend: npx prisma db push',
        error: msg,
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

export const updateTaxFee = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, valueType, value, tiers, applyTo, description, status, countryIds } = req.body;
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
      if (!['percentage', 'fixed', 'dynamic'].includes(valueType)) {
        return res.status(400).json({ success: false, message: 'valueType must be percentage, fixed or dynamic' });
      }
      updateData.valueType = valueType;
    }
    if (applyTo !== undefined) {
      if (!['bank', 'wallet', 'both'].includes(applyTo)) {
        return res.status(400).json({ success: false, message: 'applyTo must be bank, wallet or both' });
      }
      updateData.applyTo = applyTo;
    }
    if (valueType === 'dynamic' && tiers !== undefined) {
      if (!Array.isArray(tiers) || tiers.length === 0) {
        return res.status(400).json({ success: false, message: 'Dynamic tax requires at least one tier' });
      }
      updateData.tiers = tiers.map((t) => ({
        minAmount: parseFloat(t.minAmount),
        maxAmount: parseFloat(t.maxAmount),
        valueType: t.valueType === 'fixed' ? 'fixed' : 'percentage',
        value: parseFloat(t.value),
      }));
      updateData.value = null;
    } else if (valueType !== 'dynamic' && (value !== undefined || (existing.valueType !== 'dynamic' && valueType === undefined))) {
      if (value !== undefined && value !== null && value !== '') {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue < 0) {
          return res.status(400).json({ success: false, message: 'Value must be a non-negative number' });
        }
        updateData.value = numValue;
        updateData.tiers = null;
      }
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
