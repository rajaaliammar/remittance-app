import prisma from '../utils/prisma.js';

// List gift rules for a remittance bank
export const getGiftRules = async (req, res) => {
  try {
    const { bankId } = req.params;

    const rules = await prisma.remittanceBankGiftRule.findMany({
      where: { remittanceBankId: bankId },
      orderBy: { minAmount: 'asc' },
    });

    return res.json({ success: true, data: rules });
  } catch (error) {
    console.error('Error fetching gift rules:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Create a new gift rule
export const createGiftRule = async (req, res) => {
  try {
    const { bankId } = req.params;
    const { minAmount, maxAmount, giftAmount, active } = req.body;

    if (minAmount == null || maxAmount == null || giftAmount == null) {
      return res.status(400).json({
        success: false,
        message: 'minAmount, maxAmount and giftAmount are required',
      });
    }

    // Ensure bank exists
    const bank = await prisma.remittanceBank.findUnique({
      where: { id: bankId },
    });

    if (!bank) {
      return res.status(404).json({ success: false, message: 'Remittance bank not found' });
    }

    const rule = await prisma.remittanceBankGiftRule.create({
      data: {
        remittanceBankId: bankId,
        minAmount: String(minAmount),
        maxAmount: String(maxAmount),
        giftAmount: String(giftAmount),
        active: active !== undefined ? !!active : true,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Gift rule created successfully',
      data: rule,
    });
  } catch (error) {
    console.error('Error creating gift rule:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Update existing gift rule
export const updateGiftRule = async (req, res) => {
  try {
    const { bankId, id } = req.params;
    const { minAmount, maxAmount, giftAmount, active } = req.body;

    const existing = await prisma.remittanceBankGiftRule.findUnique({
      where: { id },
    });

    if (!existing || existing.remittanceBankId !== bankId) {
      return res.status(404).json({ success: false, message: 'Gift rule not found' });
    }

    const updateData = {};
    if (minAmount !== undefined) updateData.minAmount = String(minAmount);
    if (maxAmount !== undefined) updateData.maxAmount = String(maxAmount);
    if (giftAmount !== undefined) updateData.giftAmount = String(giftAmount);
    if (active !== undefined) updateData.active = !!active;

    const rule = await prisma.remittanceBankGiftRule.update({
      where: { id },
      data: updateData,
    });

    return res.json({
      success: true,
      message: 'Gift rule updated successfully',
      data: rule,
    });
  } catch (error) {
    console.error('Error updating gift rule:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Delete gift rule
export const deleteGiftRule = async (req, res) => {
  try {
    const { bankId, id } = req.params;

    const existing = await prisma.remittanceBankGiftRule.findUnique({
      where: { id },
    });

    if (!existing || existing.remittanceBankId !== bankId) {
      return res.status(404).json({ success: false, message: 'Gift rule not found' });
    }

    await prisma.remittanceBankGiftRule.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: 'Gift rule deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting gift rule:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};


