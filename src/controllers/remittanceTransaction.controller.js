import prisma from '../utils/prisma.js';
import transporter from '../utils/email.js';
import { getReceiptSettingsValues } from './receiptSetting.controller.js';
import { calculateTransactionFee } from '../utils/chargeUtils.js';
import {
  getCustomerLimits,
  getSentInPeriod,
  getApprovedKYCMaxAmount,
  startOfDayUTC,
  startOfWeekUTC,
  startOfMonthUTC,
} from '../utils/limitsHelper.js';

/**
 * Create a remittance transaction (after user confirms payment in app)
 */
export const createRemittanceTransaction = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Allow transaction when at least one KYC document is approved; block only when none is approved
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { kycData: true },
    });
    let hasApprovedKYC = false;
    if (customer?.kycData) {
      let raw = customer.kycData;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = null;
        }
      }
      const docs = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      hasApprovedKYC = docs.some((doc) => (doc.status || '').toLowerCase() === 'approved');
    }
    if (!hasApprovedKYC) {
      return res.status(403).json({
        success: false,
        message: 'You need at least one approved verification to make transactions. Complete and submit KYC, then wait for approval.',
      });
    }

    const {
      sendAmount,
      receiveAmount,
      currency,
      gatewayId,
      gatewayName,
      recipientInfo,
      paymentFieldValues,
      transferType,
      countryId,
    } = req.body || {};

    const send = parseFloat(sendAmount);
    const receive = parseFloat(receiveAmount);
    if (isNaN(send) || send < 0 || isNaN(receive) || receive < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid sendAmount and receiveAmount are required',
      });
    }

    // Enforce approved KYC form's "Max Transaction Amount" (e.g. kyc2 = 2999 USD)
    const kycMaxAmount = await getApprovedKYCMaxAmount(customerId);
    if (kycMaxAmount != null && send > kycMaxAmount) {
      return res.status(400).json({
        success: false,
        message: `This amount exceeds your transaction limit. Your approved KYC allows a maximum of ${kycMaxAmount.toFixed(2)} USD per transaction.`,
        code: 'KYC_TRANSACTION_LIMIT_EXCEEDED',
      });
    }

    // Calculate fees on backend for security and accuracy (transferType filters tax/fee by applyTo: bank | wallet | both)
    const { totalCharge, breakdown } = await calculateTransactionFee({
      amount: send,
      countryId,
      transferType: transferType === 'wallet' ? 'wallet' : 'bank'
    });

    const totalToDeduct = send + totalCharge;

    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.create !== 'function') {
      console.error('Prisma remittanceTransaction delegate missing. Run: npx prisma generate');
      return res.status(503).json({
        success: false,
        message: 'RemittanceTransaction model not available. Run: npx prisma generate and restart the server.',
      });
    }

    const rows = await prisma.$queryRaw`
      SELECT "availableBalance" FROM customers WHERE id = ${customerId}
    `;
    const row = rows?.[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    const currentBalance = row.availableBalance != null
      ? Number(row.availableBalance)
      : 12000;

    if (currentBalance < totalToDeduct) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ${currentBalance.toFixed(2)}, required (including fees): ${totalToDeduct.toFixed(2)}`,
      });
    }

    // Check daily / weekly / monthly limits from user level
    const limits = await getCustomerLimits(customerId);
    if (limits) {
      const now = new Date();
      const startDay = startOfDayUTC(now);
      const startWeek = startOfWeekUTC(now);
      const startMonth = startOfMonthUTC(now);
      const [usedDaily, usedWeekly, usedMonthly] = await Promise.all([
        limits.daily != null ? getSentInPeriod(customerId, startDay, now) : 0,
        limits.weekly != null ? getSentInPeriod(customerId, startWeek, now) : 0,
        limits.monthly != null ? getSentInPeriod(customerId, startMonth, now) : 0,
      ]);
      if (limits.daily != null && usedDaily + send > limits.daily) {
        return res.status(400).json({
          success: false,
          message: `You have exceeded your daily transfer limit. Your daily limit is ${limits.daily.toFixed(2)} ${limits.currency}. You cannot transfer more than this amount.`,
          code: 'DAILY_LIMIT_EXCEEDED',
        });
      }
      if (limits.weekly != null && usedWeekly + send > limits.weekly) {
        return res.status(400).json({
          success: false,
          message: `You have exceeded your weekly transfer limit. Your weekly limit is ${limits.weekly.toFixed(2)} ${limits.currency}. You cannot transfer more than this amount.`,
          code: 'WEEKLY_LIMIT_EXCEEDED',
        });
      }
      if (limits.monthly != null && usedMonthly + send > limits.monthly) {
        return res.status(400).json({
          success: false,
          message: `You have exceeded your monthly transfer limit. Your monthly limit is ${limits.monthly.toFixed(2)} ${limits.currency}. You cannot transfer more than this amount.`,
          code: 'MONTHLY_LIMIT_EXCEEDED',
        });
      }
    }

    const newBalance = currentBalance - totalToDeduct;

    const txType = (transferType === 'wallet' ? 'wallet' : 'bank');

    // Enrich recipientInfo with fee details for history/receipts
    const enrichedRecipientInfo = {
      ...(recipientInfo || {}),
      fee: totalCharge,
      feeBreakdown: breakdown,
      baseAmount: send,
      totalAmount: totalToDeduct,
      countryId
    };

    // Ensure charge is stored in paymentFieldValues for easy retrieval
    const enrichedPaymentFieldValues = {
      ...(paymentFieldValues || {}),
      charge: totalCharge,
      fee: totalCharge,
      feeBreakdown: breakdown,
    };

    const [transaction] = await prisma.$transaction([
      delegate.create({
        data: {
          customerId,
          type: 'Sent',
          transferType: txType,
          sendAmount: send,
          receiveAmount: receive,
          currency: currency || null,
          gatewayId: gatewayId || null,
          gatewayName: gatewayName || null,
          recipientInfo: enrichedRecipientInfo,
          paymentFieldValues: enrichedPaymentFieldValues,
          status: 'Processing',
        },
      }),
      prisma.$executeRaw`
        UPDATE customers SET "availableBalance" = ${newBalance} WHERE id = ${customerId}
      `,
    ]);

    res.status(201).json({
      success: true,
      data: {
        ...transaction,
        newBalance,
      },
    });
  } catch (error) {
    console.error('Error creating remittance transaction:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create transaction',
    });
  }
};

/**
 * List remittance transactions for the authenticated customer
 */
export const listRemittanceTransactions = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.findMany !== 'function') {
      console.error('Prisma remittanceTransaction delegate missing. Run: npx prisma generate');
      return res.status(503).json({
        success: false,
        message: 'RemittanceTransaction model not available. Run: npx prisma generate and restart the server.',
      });
    }

    const { limit = 50, offset = 0 } = req.query;
    const take = Math.min(parseInt(limit, 10) || 50, 100);
    const skip = Math.max(parseInt(offset, 10) || 0, 0);

    const [transactions, total] = await Promise.all([
      delegate.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      delegate.count({ where: { customerId } }),
    ]);

    res.json({
      success: true,
      data: transactions,
      total,
    });
  } catch (error) {
    console.error('Error listing remittance transactions:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list transactions',
    });
  }
};

/**
 * Get a single remittance transaction by ID (admin/portal)
 */
export const getRemittanceTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required',
      });
    }

    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.findUnique !== 'function') {
      return res.status(503).json({
        success: false,
        message: 'RemittanceTransaction model not available.',
      });
    }

    const transaction = await delegate.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            address: true,
          },
        },
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    res.json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    console.error('Error getting remittance transaction:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get transaction',
    });
  }
};

/**
 * List all remittance transactions (admin/portal) - for Transaction Log in dashboard
 * Optional query: customerId - filter by customer for customer profile page
 */
export const listAllRemittanceTransactions = async (req, res) => {
  try {
    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.findMany !== 'function') {
      return res.status(503).json({
        success: false,
        message: 'RemittanceTransaction model not available.',
      });
    }

    const { limit = 100, offset = 0, customerId } = req.query;
    const take = Math.min(parseInt(limit, 10) || 100, 500);
    const skip = Math.max(parseInt(offset, 10) || 0, 0);
    const where = customerId && String(customerId).trim() ? { customerId: String(customerId).trim() } : {};

    const [transactions, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
      delegate.count({ where }),
    ]);

    res.json({
      success: true,
      data: transactions,
      total,
    });
  } catch (error) {
    console.error('Error listing all remittance transactions:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list transactions',
    });
  }
};

/**
 * Send transaction receipt email to customer
 */
export const sendRemittanceTransactionReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required',
      });
    }

    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.findUnique !== 'function') {
      return res.status(503).json({
        success: false,
        message: 'RemittanceTransaction model not available.',
      });
    }

    const transaction = await delegate.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    const recipientEmail = transaction.customer?.email;
    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'Customer email is not available for this transaction',
      });
    }

    const customerName =
      [transaction.customer?.firstName, transaction.customer?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || 'Customer';

    const sendAmount = Number(transaction.sendAmount || 0);
    const receiveAmount = Number(transaction.receiveAmount || 0);
    const currency = String(transaction.currency || 'USD').toUpperCase();

    const recipientInfo = (transaction.recipientInfo && typeof transaction.recipientInfo === 'object')
      ? transaction.recipientInfo
      : {};
    const paymentFields = (transaction.paymentFieldValues && typeof transaction.paymentFieldValues === 'object')
      ? transaction.paymentFieldValues
      : {};

    const charge = Number(paymentFields.charge || paymentFields.fee || recipientInfo.fee || 0);
    const total = sendAmount + charge;
    const status = String(transaction.status || 'Processing');
    const createdAt = transaction.createdAt ? new Date(transaction.createdAt).toLocaleString('en-US') : '—';
    const paidAt = transaction.updatedAt ? new Date(transaction.updatedAt).toLocaleString('en-US') : createdAt;
    const serviceType = transaction.transferType === 'wallet' ? 'Wallet Transfer' : 'Bank Transfer';
    const receiptSettings = await getReceiptSettingsValues();
    const senderCountry = String(
      paymentFields.sendingBranchCountryName ||
      recipientInfo.sendingBranchCountryName ||
      recipientInfo.countryName ||
      '—'
    );
    const senderAddress = String(
      paymentFields.senderAddress ||
      paymentFields.address ||
      recipientInfo.senderAddress ||
      transaction.customer?.address ||
      '—'
    );
    const senderState = String(
      paymentFields.sendersState ||
      paymentFields.senderState ||
      recipientInfo.senderState ||
      '—'
    );
    const senderMobile = String(transaction.customer?.phone || paymentFields.sendingCustomerMobile || '—');
    const receiverName = String(
      recipientInfo.accountHolderName ||
      `${recipientInfo.firstName || ''} ${recipientInfo.lastName || ''}`.trim() ||
      '—'
    );
    const receiverCountry = String(
      recipientInfo.receivingBranchCountryName ||
      recipientInfo.countryName ||
      recipientInfo.country ||
      '—'
    );
    const receiverMobile = String(
      recipientInfo.phoneNumber ||
      recipientInfo.mobile ||
      recipientInfo.receiverPhone ||
      '—'
    );
    const orderNumber = String(paymentFields.orderNumber || transaction.orderNumber || '—');
    const exchangeRate = sendAmount > 0 && receiveAmount > 0
      ? (receiveAmount / sendAmount).toFixed(4)
      : '—';
    const logoHtml = receiptSettings.logoUrl
      ? `<img src="${receiptSettings.logoUrl}" alt="Receipt Logo" style="max-height:56px;max-width:220px;display:block;" />`
      : `<div style="font-size:42px;line-height:1;color:#0b66a2;font-weight:700;">${receiptSettings.brandName}</div>`;
    const disclosureLines = String(receiptSettings.disclosureText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Transaction Receipt</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; background: #f3f4f6; margin: 0; padding: 12px;">
        <div style="max-width: 980px; margin: 0 auto; background: #ffffff; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden;">
          <div style="display:flex;justify-content:space-between;gap:14px;padding:14px 16px;border-bottom:1px solid #e5e7eb;">
            <div>
              ${logoHtml}
              <div style="font-size:11px;color:#64748b;font-weight:600;">${receiptSettings.brandSubTitle}</div>
            </div>
            <div style="font-size:12px;color:#475569;text-align:right;">
              <div>${receiptSettings.companyAddress}</div>
              <div>Tel: ${receiptSettings.companyPhone}</div>
              <div>Email: ${receiptSettings.companyEmail}</div>
              <div style="margin-top:4px;font-weight:600;">${receiptSettings.receiptTitle}</div>
            </div>
          </div>
          <div style="padding:12px;">
            <p style="margin:0 0 10px;">Hello ${customerName},</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div style="border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">
                <div style="padding:10px 14px;background:#f3f4f6;border-bottom:1px solid #d1d5db;font-size:18px;">Sender Details</div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Customer Number</strong><span style="float:right;">${transaction.customerId || '—'}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Name</strong><span style="float:right;">${customerName}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Country</strong><span style="float:right;">${senderCountry}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Address</strong><span style="float:right;">${senderAddress}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>State</strong><span style="float:right;">${senderState}</span></div>
                <div style="padding:8px 14px;"><strong>Mobile</strong><span style="float:right;">${senderMobile}</span></div>
              </div>
              <div style="border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">
                <div style="padding:10px 14px;background:#f3f4f6;border-bottom:1px solid #d1d5db;font-size:18px;">Transfer Details</div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Order Number</strong><span style="float:right;">${orderNumber}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Order Status</strong><span style="float:right;">${status}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Date Time</strong><span style="float:right;">${createdAt}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Service</strong><span style="float:right;">${serviceType}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Payment Method</strong><span style="float:right;">${transaction.gatewayName || '—'}</span></div>
                <div style="padding:8px 14px;"><strong>Availability of funds</strong><span style="float:right;">${paidAt}</span></div>
              </div>
              <div style="border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">
                <div style="padding:10px 14px;background:#f3f4f6;border-bottom:1px solid #d1d5db;font-size:18px;">Receiver Details</div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Name</strong><span style="float:right;">${receiverName}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Country</strong><span style="float:right;">${receiverCountry}</span></div>
                <div style="padding:8px 14px;"><strong>Mobile</strong><span style="float:right;">${receiverMobile}</span></div>
              </div>
              <div style="border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">
                <div style="padding:10px 14px;background:#f3f4f6;border-bottom:1px solid #d1d5db;font-size:18px;">Transfer Breakdown</div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>They Receive</strong><span style="float:right;">${receiveAmount.toFixed(2)} ${currency}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Exchange Rate</strong><span style="float:right;">1 USD = ${exchangeRate === '—' ? '—' : `${exchangeRate} ${currency}`}</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>You Send</strong><span style="float:right;">${sendAmount.toFixed(2)} USD</span></div>
                <div style="padding:8px 14px;border-bottom:1px solid #e5e7eb;"><strong>Fees</strong><span style="float:right;">${charge.toFixed(2)} USD</span></div>
                <div style="padding:8px 14px;"><strong>Total Paid</strong><span style="float:right;font-size:26px;font-weight:700;">${total.toFixed(2)} USD</span></div>
              </div>
            </div>

            <div style="margin-top:12px;border:1px solid #d1d5db;border-radius:6px;padding:10px 12px;background:#f8fafc;">
              <strong>Note:</strong> ${receiptSettings.noteText}
            </div>
            <div style="margin-top:10px;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;">
              <div style="padding:10px 12px;background:#f3f4f6;border-bottom:1px solid #d1d5db;font-size:24px;">${receiptSettings.disclosureTitle}</div>
              <div style="padding:10px 12px;font-size:13px;color:#374151;">
                ${disclosureLines.map((line) => `<p style="margin:0 0 8px;">${line}</p>`).join('')}
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"BrandPay" <${process.env.SMTP_USER}>`,
      to: recipientEmail,
      subject: `BrandPay Receipt - Transaction ${transaction.id}`,
      html: emailHtml,
    });

    return res.json({
      success: true,
      message: 'Receipt email sent successfully',
      data: {
        transactionId: transaction.id,
        email: recipientEmail,
      },
    });
  } catch (error) {
    console.error('Error sending transaction receipt email:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to send transaction receipt',
    });
  }
};
