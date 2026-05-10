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
import { runOrchestrationBeforeTransaction } from '../utils/orchestration.js';
import {
  createAccountingEntryFromTransaction,
  updateAccountingEntriesForTransactionStatus,
  createRefundAccountingEntries,
} from '../utils/accounting.js';
import {
  createRemittanceInitiateJournal,
  createRemittanceCompleteJournal,
  createRemittanceRefundJournal,
} from '../utils/ledgerService.js';
import {
  runComplianceRules,
  createComplianceAlerts,
  extractBeneficiaryKey,
} from '../services/complianceRuleEngine.js';
import acceptblueService from '../services/acceptblue.service.js';

const US_STATE_NAME_TO_CODE = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
  'DISTRICT OF COLUMBIA': 'DC',
};

const normalizeStateInput = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/\./g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const resolveStateInitial = (value) => {
  const normalized = normalizeStateInput(value);
  if (!normalized) return null;
  if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  if (US_STATE_NAME_TO_CODE[normalized]) return US_STATE_NAME_TO_CODE[normalized];
  const token = normalized.split(' ').find((part) => /^[A-Z]{2}$/.test(part));
  if (token) return token;
  for (const [name, code] of Object.entries(US_STATE_NAME_TO_CODE)) {
    if (normalized.includes(name)) return code;
  }
  return null;
};

const getStateDisclosureText = async (rawStateValue) => {
  const stateInitial = resolveStateInitial(rawStateValue);
  if (!stateInitial) return null;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT "disclosureText"
        FROM "state_disclosures"
        WHERE UPPER(TRIM("stateInitial")) = UPPER(TRIM($1))
        LIMIT 1
      `,
      stateInitial,
    );
    return rows?.[0]?.disclosureText ? String(rows[0].disclosureText) : null;
  } catch {
    return null;
  }
};

const senderCustomerSelect = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  email: true,
  phone: true,
  telephone: true,
  address: true,
  unitApt: true,
  zipCode: true,
  dateOfBirth: true,
  nationality: true,
  country: true,
  region: true,
  city: true,
};

/**
 * Create a remittance transaction (after user confirms payment in app).
 * All customer send flows use this path. Orchestration runs before every transaction;
 * see runOrchestrationBeforeTransaction() and docs/ORCHESTRATION.md.
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

    const pfIncoming =
      paymentFieldValues && typeof paymentFieldValues === 'object' ? paymentFieldValues : {};
    const paymentMethodLocalId = String(
      pfIncoming.paymentMethodId || pfIncoming.savedCardId || ''
    ).trim();

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
    const { totalCharge, breakdown, tax: taxAmount, fee: feeAmount } = await calculateTransactionFee({
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

    // Wallet-funded transfer only — card-funded transfers charge Accept.blue instead (see below).
    if (!paymentMethodLocalId && currentBalance < totalToDeduct) {
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

    const newBalance = paymentMethodLocalId ? currentBalance : currentBalance - totalToDeduct;

    const txType = (transferType === 'wallet' ? 'wallet' : 'bank');

    // Enrich recipientInfo with fee details for history/receipts
    const ri = recipientInfo || {};
    const enrichedRecipientInfo = {
      ...ri,
      fee: totalCharge,
      feeBreakdown: breakdown,
      baseAmount: send,
      totalAmount: totalToDeduct,
      countryId,
    };
    // Stable key for AML beneficiary aggregation when not an internal customer id
    if (!enrichedRecipientInfo.beneficiaryId && !enrichedRecipientInfo.beneficiaryKey) {
      const acc = String(ri.accountNumber || '').trim();
      const name = String(ri.accountHolderName || ri.name || '').trim().toLowerCase();
      if (acc || name) {
        enrichedRecipientInfo.beneficiaryKey = `ext:${acc}:${name}`;
      }
    }

    // Orchestration: run before every transaction; store job and events when tables exist
    const orchestrationContext = {
      customerId,
      sendAmount: send,
      receiveAmount: receive,
      currency,
      gatewayId,
      gatewayName,
      transferType: txType,
      countryId,
      recipientInfo,
    };

    console.log('[Orchestration] createRemittanceTransaction: entering orchestration phase | customerId=', customerId, '| sendAmount=', send, '| totalToDeduct=', totalToDeduct);

    let canStoreOrchestration =
      prisma.orchestrationJob &&
      typeof prisma.orchestrationJob.create === 'function' &&
      prisma.orchestrationEvent &&
      typeof prisma.orchestrationEvent.create === 'function';

    let job = null;
    if (canStoreOrchestration) {
      try {
        job = await prisma.orchestrationJob.create({
          data: {
            type: 'pre_transaction',
            status: 'running',
            customerId,
            context: orchestrationContext,
          },
        });
        await prisma.orchestrationEvent.create({
          data: { jobId: job.id, eventType: 'orchestration_started', payload: {} },
        });
      } catch (storeErr) {
        console.warn('Orchestration store skipped (tables may be missing):', storeErr.message);
        canStoreOrchestration = false;
      }
    }

    const orchestration = await runOrchestrationBeforeTransaction(orchestrationContext);

    console.log('[Orchestration] createRemittanceTransaction: orchestration result | allowed=', orchestration.allowed, orchestration.message ? `| message=${orchestration.message}` : '');

    if (!orchestration.allowed) {
      if (canStoreOrchestration && job) {
        try {
          await prisma.orchestrationEvent.create({
            data: { jobId: job.id, eventType: 'orchestration_denied', payload: { message: orchestration.message } },
          });
          await prisma.orchestrationJob.update({
            where: { id: job.id },
            data: { status: 'failed', result: orchestration, message: orchestration.message || 'Transaction not allowed by orchestration.' },
          });
        } catch (e) {
          console.warn('Orchestration update on deny skipped:', e.message);
        }
      }
      return res.status(403).json({
        success: false,
        message: orchestration.message || 'Transaction not allowed by orchestration.',
        code: 'ORCHESTRATION_DENIED',
      });
    }

    if (canStoreOrchestration && job) {
      try {
        await prisma.orchestrationEvent.create({
          data: { jobId: job.id, eventType: 'orchestration_completed', payload: { allowed: true } },
        });
        await prisma.orchestrationJob.update({
          where: { id: job.id },
          data: { status: 'completed', result: orchestration },
        });
      } catch (e) {
        console.warn('Orchestration update on allow skipped:', e.message);
      }
    }

    let acceptBlueChargeMeta = null;
    if (paymentMethodLocalId) {
      if (!acceptblueService.isAcceptBlueConfigured()) {
        return res.status(503).json({
          success: false,
          message:
            'Card payments are not configured. Set ACCEPTBLUE_API_KEY, ACCEPTBLUE_PIN, and ACCEPTBLUE_BASE_URL on the server.',
        });
      }
      const payer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { acceptblueCustomerId: true },
      });
      if (!payer?.acceptblueCustomerId) {
        return res.status(400).json({
          success: false,
          message: 'No Accept.blue customer profile. Add a saved card before paying by card.',
        });
      }
      const cardRow = await prisma.paymentMethod.findFirst({
        where: { id: paymentMethodLocalId, customerId },
      });
      if (!cardRow) {
        return res.status(404).json({
          success: false,
          message: 'Saved payment method not found.',
        });
      }
      try {
        const chargeAmount = Number(Number(totalToDeduct).toFixed(2));
        const abResult = await acceptblueService.createCharge({
          payment_method_id: cardRow.acceptbluePaymentMethodId,
          amount: chargeAmount,
          description: `Remittance ${currency || 'USD'} send ${send.toFixed(2)} + fees`,
        });
        acceptBlueChargeMeta = {
          acceptblueTransactionId: abResult.id ?? abResult.transaction_id ?? null,
          acceptblueStatus: abResult.status ?? null,
        };
      } catch (e) {
        console.error('[Accept.blue] Remittance charge failed:', e?.message || e);
        return res.status(Number(e.status) >= 400 ? e.status : 402).json({
          success: false,
          message: e.message || 'Card payment failed',
          details: e.details,
        });
      }
    }

    const enrichedPaymentFieldValues = {
      ...(paymentFieldValues || {}),
      charge: totalCharge,
      fee: totalCharge,
      feeBreakdown: breakdown,
      ...(acceptBlueChargeMeta || {}),
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

    if (canStoreOrchestration && job) {
      try {
        await prisma.orchestrationJob.update({
          where: { id: job.id },
          data: { remittanceTransactionId: transaction.id },
        });
        console.log('[Orchestration] createRemittanceTransaction: job linked to transaction | jobId=', job.id, '| transactionId=', transaction.id);
      } catch (e) {
        console.warn('Orchestration link to transaction skipped:', e.message);
      }
    }

    // ── Compliance Rule Engine ────────────────────────────────────────────
    // Run AML/threshold/behavioral rules. On a match, update transaction
    // status to "Hold" and create compliance alerts. Never block the
    // response — if the engine fails, the transaction stays as Processing.
    let complianceHold = false;
    try {
      const beneficiaryCustomerId = enrichedRecipientInfo?.beneficiaryId || null;
      const beneficiaryKeyPlain = enrichedRecipientInfo?.beneficiaryKey || null;
      const currentBeneficiaryKey = extractBeneficiaryKey(enrichedRecipientInfo);
      const ipAddress =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        null;
      const deviceId =
        req.headers['x-device-id'] || req.headers['x-device-fingerprint'] || null;

      console.log('[Compliance] Running AML rules | transactionId=', transaction.id, '| amount=', send);

      const { hold, triggeredRules, riskScore } = await runComplianceRules({
        senderId: customerId,
        beneficiaryCustomerId,
        beneficiaryKeyPlain,
        currentBeneficiaryKey,
        amount: send,
        excludeTransactionId: transaction.id,
        ipAddress,
        deviceId,
      });

      // Always persist risk score, triggered rules, IP and device info
      const complianceUpdate = {
        riskScore,
        triggeredRules: triggeredRules.map((r) => r.code),
        ipAddress: ipAddress || null,
        deviceId: deviceId || null,
      };

      if (hold) {
        complianceHold = true;
        complianceUpdate.status = 'Hold';
        complianceUpdate.complianceHoldAt = new Date();

        await prisma.remittanceTransaction.update({
          where: { id: transaction.id },
          data: complianceUpdate,
        });

        await createComplianceAlerts(transaction.id, customerId, triggeredRules);

        // Notify the customer's socket room about the hold
        const io = req.app?.get?.('io');
        if (io) {
          io.to(`user:${customerId}`).emit('transaction-status', {
            transactionId: transaction.id,
            status: 'Hold',
            message: 'Your transaction is under compliance review. Estimated review time: 2–24 hours.',
          });
        }

        console.log(
          '[Compliance] Transaction placed on HOLD | transactionId=', transaction.id,
          '| rules=', triggeredRules.map((r) => r.code).join(', '),
          '| riskScore=', riskScore,
        );
      } else {
        // No hold — still persist risk score and device info
        await prisma.remittanceTransaction.update({
          where: { id: transaction.id },
          data: complianceUpdate,
        });
        console.log('[Compliance] No rules triggered | transactionId=', transaction.id, '| riskScore=', riskScore);
      }
    } catch (compErr) {
      console.warn('[Compliance] Rule engine error (transaction unaffected):', compErr.message);
    }

    // Accounting: create revenue (fee + tax) and expense entries from this transaction (so app transactions appear in portal)
    try {
      await createAccountingEntryFromTransaction(transaction, 'pending', {
        totalCharge,
        tax: typeof taxAmount === 'number' ? taxAmount : undefined,
        fee: typeof feeAmount === 'number' ? feeAmount : undefined,
      });
    } catch (accErr) {
      console.warn('Accounting entry creation skipped:', accErr.message);
    }

    // Ledger Service: Phase 1 - Remittance Initiate
    try {
      // transaction.currency is the receive currency (destination), send is always USD
      const sendCurrency = 'USD'; // Base currency for sending (always USD)
      const receiveCurrency = currency || transaction.currency || 'USD'; // Destination currency (user selected: ETB, GBP, etc.)
      const exchangeRate = receive > 0 && send > 0 ? (receive / send).toFixed(6) : null;
      
      console.log('[Ledger Service] Phase 1 (initiate) - Preparing journal entry:');
      console.log(`  Transaction ID: ${transaction.id}`);
      console.log(`  Job ID: ${job?.id || 'N/A'}`);
      console.log(`  Actor ID (Customer): ${customerId}`);
      console.log(`  Send Amount: ${send} ${sendCurrency}`);
      console.log(`  Fee Amount: ${feeAmount || totalCharge}`);
      console.log(`  Receive Amount: ${receive} ${receiveCurrency}`);
      console.log(`  Exchange Rate: ${exchangeRate || 'N/A'}`);
      
      await createRemittanceInitiateJournal({
        transactionId: transaction.id,
        jobId: job?.id,
        actorId: customerId,
        sendAmount: send,
        feeAmount: feeAmount || totalCharge,
        currency: sendCurrency, // Always USD for send
        receiveAmount: receive,
        receiveCurrency: receiveCurrency, // Destination currency (ETB, GBP, etc. - user selected)
        exchangeRate,
      });
    } catch (ledgerErr) {
      console.warn('[Ledger Service] Phase 1 (initiate) journal creation failed:', ledgerErr.message);
      // Don't fail the transaction if ledger call fails
    }

    console.log('[Orchestration] createRemittanceTransaction: completed successfully | transactionId=', transaction.id);

    const io = req.app && req.app.get && req.app.get('io');
    if (io) {
      io.emit('accounting:updated');
      console.log('[Socket] Emitted accounting:updated after transaction create');
    }

    // Re-read the transaction to return the latest status (may have been updated to Hold)
    const finalTransaction = await prisma.remittanceTransaction.findUnique({
      where: { id: transaction.id },
    });

    res.status(201).json({
      success: true,
      data: {
        ...(finalTransaction || transaction),
        newBalance,
      },
      ...(complianceHold && {
        complianceHold: true,
        holdMessage: 'Your transaction is under compliance review. Estimated review time: 2–24 hours.',
      }),
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
          select: senderCustomerSelect,
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
 * Update a remittance transaction (admin/portal)
 * Can update status and other fields. When status changes to Completed, Phase 2 ledger entry is created.
 */
export const updateRemittanceTransaction = async (req, res) => {
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
          select: { id: true },
        },
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    const { status, ...otherUpdates } = req.body || {};
    const oldStatus = (transaction.status || '').toLowerCase();
    const newStatus = status ? String(status).toLowerCase() : oldStatus;
    const statusChanged = oldStatus !== newStatus;

    const updateData = {
      ...otherUpdates,
      ...(statusChanged && { status: String(status) }),
      ...(statusChanged && { updatedAt: new Date() }),
    };

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update',
      });
    }

    const updated = await delegate.update({
      where: { id },
      data: updateData,
      include: {
        customer: {
          select: senderCustomerSelect,
        },
      },
    });

    // If status changed to Completed, update accounting, ledger, and customer lastTransactionAt
    if (statusChanged && newStatus === 'completed') {
      try {
        // Update customer's lastTransactionAt for future inactive-account detection
        await prisma.$executeRaw`
          UPDATE customers SET "lastTransactionAt" = NOW(), "updatedAt" = NOW()
          WHERE id = ${transaction.customerId}
        `;
      } catch (e) {
        console.warn('lastTransactionAt update skipped:', e.message);
      }

      try {
        await updateAccountingEntriesForTransactionStatus(id, 'Completed');
      } catch (accErr) {
        console.warn('Accounting update on complete skipped:', accErr.message);
      }

      // Ledger Service: Phase 2 - Remittance Complete
      try {
        // Get orchestration job ID if available
        let jobId = null;
        if (prisma.orchestrationJob && typeof prisma.orchestrationJob.findFirst === 'function') {
          const job = await prisma.orchestrationJob.findFirst({
            where: { remittanceTransactionId: id },
            select: { id: true },
          });
          jobId = job?.id;
        }

        const sendAmount = Number(transaction.sendAmount ?? 0);
        const receiveAmount = Number(transaction.receiveAmount ?? 0);
        const receiveCurrency = transaction.currency || 'USD';
        
        // Extract exchange rate information from transaction
        // If exchangeRate is stored, use it; otherwise calculate from amounts
        const exchangeRate = transaction.exchangeRate 
          ? Number(transaction.exchangeRate) 
          : (sendAmount > 0 && receiveAmount > 0 ? receiveAmount / sendAmount : null);
        
        // For Phase 2, we need costRate and offeredRate
        // If not available, use exchangeRate for both (or extract from paymentFieldValues)
        const paymentFieldValues = transaction.paymentFieldValues && typeof transaction.paymentFieldValues === 'object'
          ? transaction.paymentFieldValues
          : {};
        const costRate = paymentFieldValues.costRate || paymentFieldValues.cost_rate || exchangeRate;
        const offeredRate = paymentFieldValues.offeredRate || paymentFieldValues.offered_rate || exchangeRate || costRate;
        const payoutPartnerId = paymentFieldValues.payoutPartnerId || paymentFieldValues.payout_partner_id || 'payout_partner_id';

        await createRemittanceCompleteJournal({
          transactionId: id,
          jobId,
          actorId: req.user?.id || 'backoffice_user',
          sendAmount,
          receiveAmount,
          receiveCurrency,
          costRate: costRate ? Number(costRate) : null,
          offeredRate: offeredRate ? Number(offeredRate) : null,
          payoutPartnerId,
        });
      } catch (ledgerErr) {
        console.warn('[Ledger Service] Phase 2 (complete) journal creation failed:', ledgerErr.message);
        // Don't fail the update if ledger call fails
      }
    }

    // If status changed to Failed/Refunded, update accounting
    if (statusChanged && ['failed', 'refunded', 'canceled'].includes(newStatus)) {
      try {
        await updateAccountingEntriesForTransactionStatus(id, String(status));
      } catch (accErr) {
        console.warn('Accounting update on status change skipped:', accErr.message);
      }
    }

    const io = req.app && req.app.get && req.app.get('io');
    if (io) {
      io.emit('accounting:updated');
      console.log('[Socket] Emitted accounting:updated after transaction update');
    }

    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: updated,
    });
  } catch (error) {
    console.error('Error updating remittance transaction:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update transaction',
    });
  }
};

/**
 * Reject a remittance transaction (admin/portal). Sets status to Failed and refunds customer balance.
 * Only allowed when status is Processing.
 */
export const rejectRemittanceTransaction = async (req, res) => {
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
          select: { id: true, availableBalance: true },
        },
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    const status = (transaction.status || '').toLowerCase();
    if (status !== 'processing' && status !== 'awaiting' && status !== 'hold' && status !== 'manual_review') {
      return res.status(400).json({
        success: false,
        message: `Transaction cannot be rejected. Current status: ${transaction.status}. Only Processing, Awaiting, Hold, or Manual_Review transactions can be rejected.`,
      });
    }

    const customerId = transaction.customerId;
    const sendAmount = Number(transaction.sendAmount ?? 0);
    const recipientInfo = transaction.recipientInfo && typeof transaction.recipientInfo === 'object'
      ? transaction.recipientInfo
      : {};
    const paymentFieldValues = transaction.paymentFieldValues && typeof transaction.paymentFieldValues === 'object'
      ? transaction.paymentFieldValues
      : {};
    const fee = Number(recipientInfo.fee ?? paymentFieldValues.charge ?? paymentFieldValues.fee ?? 0);
    const totalToRefund = sendAmount + fee;

    const rows = await prisma.$queryRaw`
      SELECT "availableBalance" FROM customers WHERE id = ${customerId}
    `;
    const currentBalance = rows?.[0]?.availableBalance != null ? Number(rows[0].availableBalance) : 0;
    const newBalance = currentBalance + totalToRefund;

    const txOperations = [
      delegate.update({
        where: { id },
        data: { status: 'Failed', updatedAt: new Date() },
      }),
      prisma.$executeRaw`
        UPDATE customers SET "availableBalance" = ${newBalance}, "updatedAt" = NOW() WHERE id = ${customerId}
      `,
    ];

    // Mark related orchestration job(s) as failed so Orchestration Jobs table shows rejected state
    if (prisma.orchestrationJob && typeof prisma.orchestrationJob.updateMany === 'function') {
      txOperations.push(
        prisma.orchestrationJob.updateMany({
          where: { remittanceTransactionId: id },
          data: { status: 'failed', message: 'Transaction rejected by admin.', updatedAt: new Date() },
        })
      );
    }

    await prisma.$transaction(txOperations);

    // Accounting: mark related entries as reversed and create refund entry
    try {
      await updateAccountingEntriesForTransactionStatus(id, 'Failed');
      await createRefundAccountingEntries(transaction, req.user?.id);
    } catch (accErr) {
      console.warn('Accounting update on reject skipped:', accErr.message);
    }

    // Ledger Service: Phase 3 - Remittance Refund
    try {
      // Get orchestration job ID if available
      let jobId = null;
      if (prisma.orchestrationJob && typeof prisma.orchestrationJob.findFirst === 'function') {
        const job = await prisma.orchestrationJob.findFirst({
          where: { remittanceTransactionId: id },
          select: { id: true },
        });
        jobId = job?.id;
      }

      await createRemittanceRefundJournal({
        transactionId: id,
        jobId,
        actorId: req.user?.id || 'backoffice_user',
        sendAmount,
        feeAmount: fee,
        customerId,
        currency: transaction.currency || 'USD',
      });
    } catch (ledgerErr) {
      console.warn('[Ledger Service] Phase 3 (refund) journal creation failed:', ledgerErr.message);
      // Don't fail the refund if ledger call fails
    }

    const updated = await delegate.findUnique({
      where: { id },
      include: {
        customer: {
          select: senderCustomerSelect,
        },
      },
    });

    const io = req.app && req.app.get && req.app.get('io');
    if (io) {
      io.emit('accounting:updated');
      console.log('[Socket] Emitted accounting:updated after transaction reject');
    }

    res.json({
      success: true,
      message: 'Transaction rejected. Customer balance has been refunded.',
      data: updated,
    });
  } catch (error) {
    console.error('Error rejecting remittance transaction:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to reject transaction',
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
            select: senderCustomerSelect,
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
          select: senderCustomerSelect,
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
    const stateDisclosureText = await getStateDisclosureText(senderState);
    const disclosureContent = stateDisclosureText || receiptSettings.disclosureText;
    const disclosureLines = String(disclosureContent || '')
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
