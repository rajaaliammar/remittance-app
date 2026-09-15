import prisma from '../utils/prisma.js';
import acceptblueService from '../services/acceptblue.service.js';

/**
 * POST /api/acceptblue/customers
 * Create an Accept.blue customer profile for the authenticated user.
 * If one already exists, returns the existing ID.
 */
export const createCustomer = async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, firstName: true, lastName: true, acceptblueCustomerId: true },
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.acceptblueCustomerId) {
      return res.json({
        success: true,
        data: { customerId: customer.acceptblueCustomerId },
        message: 'Customer profile already exists',
      });
    }

    const result = await acceptblueService.createCustomer({
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
    });

    const acceptblueCustomerId = String(result.id || result.customer_id);

    await prisma.customer.update({
      where: { id: req.user.id },
      data: { acceptblueCustomerId },
    });

    res.status(201).json({
      success: true,
      data: { customerId: acceptblueCustomerId },
    });
  } catch (error) {
    console.error('Error creating Accept.blue customer:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to create customer profile',
    });
  }
};

/**
 * POST /api/acceptblue/cards
 * Validate and vault a card for the authenticated user.
 * Automatically creates the Accept.blue customer if one doesn't exist.
 */
export const addCard = async (req, res) => {
  try {
    const { cardNumber, expiryMonth, expiryYear, cvv, holderName, zipCode } = req.body;

    if (!cardNumber || !expiryMonth || !expiryYear || !cvv) {
      return res.status(400).json({
        success: false,
        message: 'cardNumber, expiryMonth, expiryYear, and cvv are required',
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, firstName: true, lastName: true, acceptblueCustomerId: true },
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    let acceptblueCustomerId = customer.acceptblueCustomerId;

    // Lazily create customer in Accept.blue if not yet created
    if (!acceptblueCustomerId) {
      const custResult = await acceptblueService.createCustomer({
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
      });
      acceptblueCustomerId = String(custResult.id || custResult.customer_id);
      await prisma.customer.update({
        where: { id: req.user.id },
        data: { acceptblueCustomerId },
      });
    }

    // Validate card with $0 verification
    const card = cardNumber.replace(/\s/g, '');
    await acceptblueService.verifyCard({
      card,
      expiry_month: expiryMonth,
      expiry_year: expiryYear,
      cvv,
      zip: zipCode,
    });

    // Vault the card under the customer profile
    const pmResult = await acceptblueService.createPaymentMethod(acceptblueCustomerId, {
      card,
      expiry_month: expiryMonth,
      expiry_year: expiryYear,
      cvv,
      name: holderName,
      zip: zipCode,
    });

    const acceptbluePaymentMethodId = String(pmResult.id || pmResult.payment_method_id);

    // Determine card brand from first digit
    const brand = detectCardBrand(card);
    const last4 = card.slice(-4);

    // Check if this is the first card (make it default)
    const existingCount = await prisma.paymentMethod.count({
      where: { customerId: req.user.id },
    });

    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        customerId: req.user.id,
        acceptbluePaymentMethodId,
        brand,
        last4,
        expiryMonth,
        expiryYear,
        holderName: holderName || null,
        isDefault: existingCount === 0,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: paymentMethod.id,
        brand: paymentMethod.brand,
        last4: paymentMethod.last4,
        expiryMonth: paymentMethod.expiryMonth,
        expiryYear: paymentMethod.expiryYear,
        holderName: paymentMethod.holderName,
        isDefault: paymentMethod.isDefault,
      },
    });
  } catch (error) {
    console.error('Error adding card:', error);
    const raw = String(error?.message || '');
    const message =
      /Failed to parse URL|Invalid URL|ERR_INVALID_URL/i.test(raw)
        ? 'Accept.blue is misconfigured. Set ACCEPTBLUE_BASE_URL with https:// (e.g. https://api.develop.accept.blue/api/v2).'
        : raw || 'Failed to add card';
    res.status(error.status || 500).json({
      success: false,
      message,
    });
  }
};

/**
 * GET /api/acceptblue/cards
 * List all saved cards for the authenticated user.
 */
export const listCards = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, private, must-revalidate');
    const cards = await prisma.paymentMethod.findMany({
      where: { customerId: req.user.id },
      select: {
        id: true,
        brand: true,
        last4: true,
        expiryMonth: true,
        expiryYear: true,
        holderName: true,
        isDefault: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: cards });
  } catch (error) {
    console.error('Error listing cards:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch saved cards' });
  }
};

/**
 * DELETE /api/acceptblue/cards/:id
 * Remove a saved card.
 */
export const deleteCard = async (req, res) => {
  try {
    const { id } = req.params;

    const card = await prisma.paymentMethod.findFirst({
      where: { id, customerId: req.user.id },
    });

    if (!card) {
      return res.status(404).json({ success: false, message: 'Card not found' });
    }

    // Remove from Accept.blue
    try {
      await acceptblueService.deletePaymentMethod(card.acceptbluePaymentMethodId);
    } catch (e) {
      console.warn('Accept.blue delete warning (proceeding with local removal):', e.message);
    }

    await prisma.paymentMethod.delete({ where: { id } });

    // If deleted card was default, promote the next card
    if (card.isDefault) {
      const nextCard = await prisma.paymentMethod.findFirst({
        where: { customerId: req.user.id },
        orderBy: { createdAt: 'asc' },
      });
      if (nextCard) {
        await prisma.paymentMethod.update({
          where: { id: nextCard.id },
          data: { isDefault: true },
        });
      }
    }

    res.json({ success: true, message: 'Card removed successfully' });
  } catch (error) {
    console.error('Error deleting card:', error);
    res.status(500).json({ success: false, message: 'Failed to remove card' });
  }
};

/**
 * POST /api/acceptblue/charge
 * Charge a saved payment method.
 */
export const chargeCard = async (req, res) => {
  try {
    const { paymentMethodId, amount, currency, description } = req.body;
    const { roundMoney } = await import('../utils/money.js');

    if (!paymentMethodId || amount == null) {
      return res.status(400).json({
        success: false,
        message: 'paymentMethodId and amount are required',
      });
    }

    const chargeAmount = roundMoney(amount);
    if (!(chargeAmount > 0)) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: req.user.id },
      select: { acceptblueCustomerId: true },
    });

    if (!customer?.acceptblueCustomerId) {
      return res.status(400).json({
        success: false,
        message: 'No payment profile found. Please add a card first.',
      });
    }

    const card = await prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, customerId: req.user.id },
    });

    if (!card) {
      return res.status(404).json({ success: false, message: 'Payment method not found' });
    }

    const result = await acceptblueService.createCharge({
      payment_method_id: card.acceptbluePaymentMethodId,
      amount: chargeAmount,
      description: description || `Remittance payment`,
      reference: req.body?.remittanceTransactionId || undefined,
    });

    res.json({
      success: true,
      data: {
        transactionId: result.id || result.transaction_id,
        status: result.status || 'approved',
        amount: chargeAmount,
        currency: currency || 'USD',
        card: { brand: card.brand, last4: card.last4 },
      },
    });
  } catch (error) {
    console.error('Error charging card:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Payment failed',
    });
  }
};

/**
 * GET /api/acceptblue/admin/customers/:customerId/cards
 * Admin endpoint to view a customer's saved cards.
 */
export const adminListCustomerCards = async (req, res) => {
  try {
    const { customerId } = req.params;

    const cards = await prisma.paymentMethod.findMany({
      where: { customerId },
      select: {
        id: true,
        brand: true,
        last4: true,
        expiryMonth: true,
        expiryYear: true,
        holderName: true,
        isDefault: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: cards });
  } catch (error) {
    console.error('Error fetching customer cards (admin):', error);
    res.status(500).json({ success: false, message: 'Failed to fetch customer cards' });
  }
};

/**
 * Detect card brand from first digits of PAN.
 */
function detectCardBrand(pan) {
  const d = (pan || '').replace(/\D/g, '');
  if (d.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^6(?:011|5)/.test(d)) return 'Discover';
  if (/^35/.test(d)) return 'JCB';
  if (/^3(?:0[0-5]|[68])/.test(d)) return 'Diners';
  return 'Card';
}
