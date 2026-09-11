import prisma from '../utils/prisma.js';
import transporter, { isSmtpConfigured } from '../utils/email.js';
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
  updateAccountingEntriesForTransactionStatus,
  createRefundAccountingEntries,
} from '../utils/accounting.js';
import {
  createRemittanceCompleteJournal,
  createRemittanceRefundJournal,
} from '../utils/ledgerService.js';
import { notifyCustomerAsync } from '../utils/customerNotify.js';
import acceptblueService from '../services/acceptblue.service.js';
import { enqueuePostTransactionJobs } from '../queues/enqueue.js';
import {
  WalletError,
  debitCustomerWallet,
  lockCustomerWallet,
} from '../utils/walletLock.js';
import {
  prepareSameRailRefund,
  commitSameRailRefund,
  sameRailRefundMessage,
} from '../utils/sameRailRefund.js';
import {
  kycDataSatisfiesVerification,
  tryApprovePendingCustomerFromCachedStatus,
} from '../utils/amlAutoApprove.js';
import { upsertSavedRecipientFromSend } from './savedRecipient.controller.js';

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

const getStateDisclosureText = async (rawStateValue, countryHint = '') => {
  const region = String(rawStateValue || '').trim();
  if (!region || region === '—') return null;
  try {
    const country = String(countryHint || '').trim();
    const isUsSender =
      !country ||
      /united states|^usa$|^us$/i.test(country) ||
      country.toUpperCase() === 'US';

    // Prefer name match for non-US (e.g. Punjab) and always try name first when possible.
    const byName = await prisma.$queryRawUnsafe(
      `
        SELECT "disclosureText", "stateName", "stateInitial"
        FROM "state_disclosures"
        WHERE LOWER(TRIM("stateName")) = LOWER(TRIM($1))
           OR LOWER(TRIM("stateName")) LIKE LOWER('%' || TRIM($1) || '%')
           OR LOWER(TRIM($1)) LIKE LOWER('%' || TRIM("stateName") || '%')
        ORDER BY
          CASE WHEN LOWER(TRIM("stateName")) = LOWER(TRIM($1)) THEN 0 ELSE 1 END,
          LENGTH(TRIM("stateName")) ASC
        LIMIT 1
      `,
      region,
    );
    if (byName?.[0]?.disclosureText && !isUsSender) {
      return String(byName[0].disclosureText);
    }

    const stateInitial = resolveStateInitial(region);
    if (stateInitial) {
      const rows = await prisma.$queryRawUnsafe(
        `
          SELECT "disclosureText"
          FROM "state_disclosures"
          WHERE UPPER(TRIM("stateInitial")) = UPPER(TRIM($1))
          LIMIT 1
        `,
        stateInitial,
      );
      if (rows?.[0]?.disclosureText) return String(rows[0].disclosureText);
    }

    if (byName?.[0]?.disclosureText) return String(byName[0].disclosureText);

    const codeGuess = String(region)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10);
    if (codeGuess.length >= 2) {
      const rows = await prisma.$queryRawUnsafe(
        `
          SELECT "disclosureText"
          FROM "state_disclosures"
          WHERE UPPER(TRIM("stateInitial")) = UPPER(TRIM($1))
          LIMIT 1
        `,
        codeGuess,
      );
      if (rows?.[0]?.disclosureText) return String(rows[0].disclosureText);
    }
    return null;
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

    // Allow when KYC approved OR LiveEx Completed / docs+face match
    let customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        status: true,
        approvedAt: true,
        approvedBy: true,
        kycData: true,
      },
    });
    try {
      const approval = await tryApprovePendingCustomerFromCachedStatus(customer, req);
      if (approval?.kycData != null || approval?.newlyApproved) {
        customer = await prisma.customer.findUnique({
          where: { id: customerId },
          select: {
            id: true,
            status: true,
            approvedAt: true,
            approvedBy: true,
            kycData: true,
          },
        });
      }
    } catch (err) {
      console.warn('[Remittance] cache auto-approve skipped:', err.message);
    }
    const hasApprovedKYC = kycDataSatisfiesVerification(customer?.kycData);
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
        code: orchestration.code || 'ORCHESTRATION_DENIED',
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
          fundingSource: 'CARD',
          acceptblueTransactionId:
            abResult.id ?? abResult.transaction_id ?? abResult.reference_number ?? null,
          acceptblueReferenceNumber: abResult.reference_number ?? abResult.id ?? null,
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
      // fundingSource records the collection rail so refunds cannot be misapplied to the wallet.
      fundingSource: paymentMethodLocalId ? 'CARD' : 'WALLET',
      ...(acceptBlueChargeMeta || {}),
    };

    let transaction;
    let newBalance;
    try {
      const result = await prisma.$transaction(async (tx) => {
        let balanceAfterDebit = null;
        if (!paymentMethodLocalId) {
          const debitResult = await debitCustomerWallet(tx, customerId, totalToDeduct);
          balanceAfterDebit = debitResult.newBalance;
        } else {
          balanceAfterDebit = await lockCustomerWallet(tx, customerId);
        }

        const created = await tx.remittanceTransaction.create({
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
        });

        return { transaction: created, newBalance: balanceAfterDebit };
      });
      transaction = result.transaction;
      newBalance = result.newBalance;
    } catch (walletErr) {
      if (walletErr instanceof WalletError) {
        return res.status(walletErr.statusCode).json({
          success: false,
          message: walletErr.message,
          code: walletErr.code,
        });
      }
      throw walletErr;
    }

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

    const ipAddress =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      null;
    const deviceId =
      req.headers['x-device-id'] || req.headers['x-device-fingerprint'] || null;

    const queueResult = await enqueuePostTransactionJobs({
      transactionId: transaction.id,
      customerId,
      send,
      receive,
      currency: currency || transaction.currency,
      feeAmount,
      totalCharge,
      taxAmount,
      orchestrationJobId: job?.id || null,
      enrichedRecipientInfo,
      recipientInfo: enrichedRecipientInfo,
      transaction,
      ipAddress,
      deviceId,
      reqMeta: { ipAddress, deviceId },
    });

    console.log(
      '[Orchestration] createRemittanceTransaction: completed | transactionId=',
      transaction.id,
      '| background=',
      queueResult.mode,
    );

    // Persist recipient for Recipients list / Send again
    void upsertSavedRecipientFromSend(customerId, {
      ...(enrichedRecipientInfo && typeof enrichedRecipientInfo === 'object'
        ? enrichedRecipientInfo
        : {}),
      transferType: transaction.transferType || enrichedRecipientInfo?.transferType,
      bankId: enrichedRecipientInfo?.bankId,
      walletId: enrichedRecipientInfo?.walletId,
    });

    res.status(201).json({
      success: true,
      data: {
        ...transaction,
        status: 'Processing',
        newBalance,
      },
      backgroundProcessing: true,
      queued: queueResult.queued,
      message:
        'Transfer submitted successfully. AML, ledger, and compliance checks are processing in the background.',
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

    const { parsePaginationQuery, parseSortQuery, sendPaginatedJson } = await import('../utils/pagination.js');
    const pagination = parsePaginationQuery(req.query, { defaultLimit: 50, maxLimit: 100 });
    const { status, type } = req.query;

    const where = { customerId };
    if (status) {
      const normalized = String(status).toLowerCase();
      if (normalized === 'pending') {
        where.status = { in: ['processing', 'hold', 'manual_review'] };
      } else {
        where.status = normalized;
      }
    }
    if (type) {
      where.type = String(type);
    }

    const orderBy = parseSortQuery(req.query, ['createdAt', 'sendAmount', 'status'], 'createdAt');

    const [transactions, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy,
        take: pagination.take,
        skip: pagination.skip,
      }),
      delegate.count({ where }),
    ]);

    sendPaginatedJson(res, { data: transactions, total, pagination });
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

    if (req.user?.type === 'customer' && transaction.customerId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
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

    if (statusChanged && newStatus === 'refunded') {
      const refundableStatuses = ['processing', 'awaiting', 'hold', 'manual_review', 'completed'];
      if (!refundableStatuses.includes(oldStatus)) {
        return res.status(400).json({
          success: false,
          message: `Transaction cannot be refunded. Current status: ${transaction.status}.`,
        });
      }

      const customerId = transaction.customerId;

      let prepared;
      try {
        // CARD: Accept.blue void/refund first. If the provider call fails we throw
        // here and never mark the remittance refunded or credit the wallet.
        prepared = await prepareSameRailRefund(transaction);
      } catch (providerErr) {
        return res.status(providerErr.status >= 400 ? providerErr.status : 502).json({
          success: false,
          message: providerErr.message || 'Card void/refund failed. Transaction was not marked refunded.',
          code: providerErr.code || 'ACCEPTBLUE_REFUND_FAILED',
          details: providerErr.details,
        });
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          const { updated } = await commitSameRailRefund(tx, {
            transactionId: id,
            customerId,
            prepared,
            status: 'Refunded',
          });
          return tx.remittanceTransaction.findUnique({
            where: { id: updated.id },
            include: {
              customer: { select: senderCustomerSelect },
            },
          });
        });

        try {
          await updateAccountingEntriesForTransactionStatus(id, 'Refunded');
        } catch (accErr) {
          console.warn('Accounting update on refund skipped:', accErr.message);
        }

        return res.json({
          success: true,
          message: sameRailRefundMessage(prepared.fundingSource, 'refunded'),
          data: result,
        });
      } catch (walletErr) {
        if (walletErr instanceof WalletError) {
          return res.status(walletErr.statusCode).json({
            success: false,
            message: walletErr.message,
            code: walletErr.code,
          });
        }
        throw walletErr;
      }
    }

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

    if (statusChanged && transaction.customerId) {
      const statusLabel = String(status || updated.status || '');
      let title = 'Transfer updated';
      let body = `Your transfer status is now ${statusLabel}.`;
      if (newStatus === 'completed') {
        title = 'Transfer completed';
        body = 'Your money transfer has been completed successfully.';
      } else if (newStatus === 'hold' || newStatus === 'manual_review') {
        title = 'Transfer under review';
        body = 'Your transfer is under compliance review. We will notify you when it is updated.';
      } else if (['failed', 'refunded', 'canceled', 'rejected'].includes(newStatus)) {
        title = 'Transfer not completed';
        body = `Your transfer could not be completed (status: ${statusLabel}).`;
      }
      notifyCustomerAsync(
        transaction.customerId,
        {
          title,
          body,
          data: {
            type: 'transaction',
            screen: 'history',
            transactionId: id,
            status: statusLabel,
          },
        },
        io
      );
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
 * Reject a remittance transaction (admin/portal). Sets status to Failed and
 * returns funds on the original rail (wallet credit OR Accept.blue void/refund).
 * Only allowed when status is Processing, Awaiting, Hold, or Manual_Review.
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

    let prepared;
    try {
      // Same-rail: CARD calls Accept.blue first. Provider failure aborts — status stays unchanged.
      prepared = await prepareSameRailRefund(transaction);
    } catch (providerErr) {
      return res.status(providerErr.status >= 400 ? providerErr.status : 502).json({
        success: false,
        message: providerErr.message || 'Card void/refund failed. Transaction was not marked refunded.',
        code: providerErr.code || 'ACCEPTBLUE_REFUND_FAILED',
        details: providerErr.details,
      });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await commitSameRailRefund(tx, {
          transactionId: id,
          customerId,
          prepared,
          status: 'Failed',
        });

        if (prisma.orchestrationJob && typeof tx.orchestrationJob?.updateMany === 'function') {
          await tx.orchestrationJob.updateMany({
            where: { remittanceTransactionId: id },
            data: {
              status: 'failed',
              message: 'Transaction rejected by admin.',
              updatedAt: new Date(),
            },
          });
        }
      });
    } catch (walletErr) {
      if (walletErr instanceof WalletError) {
        return res.status(walletErr.statusCode).json({
          success: false,
          message: walletErr.message,
          code: walletErr.code,
        });
      }
      throw walletErr;
    }

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
      message: sameRailRefundMessage(prepared.fundingSource, 'rejected'),
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

    const { parsePaginationQuery, parseSortQuery, sendPaginatedJson } = await import('../utils/pagination.js');
    const pagination = parsePaginationQuery(req.query, { defaultLimit: 50, maxLimit: 500 });
    const { customerId, search, status, transferType } = req.query;

    const where = {};
    if (customerId && String(customerId).trim()) {
      where.customerId = String(customerId).trim();
    }
    if (status) {
      where.status = String(status);
    }
    if (transferType) {
      where.transferType = String(transferType);
    }
    if (search && String(search).trim()) {
      const q = String(search).trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { orderNumber: { contains: q, mode: 'insensitive' } },
        { remittanceId: { contains: q, mode: 'insensitive' } },
        { gatewayName: { contains: q, mode: 'insensitive' } },
        { customer: { email: { contains: q, mode: 'insensitive' } } },
        { customer: { firstName: { contains: q, mode: 'insensitive' } } },
        { customer: { lastName: { contains: q, mode: 'insensitive' } } },
        { customer: { phone: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const orderBy = parseSortQuery(
      req.query,
      ['createdAt', 'sendAmount', 'receiveAmount', 'status', 'updatedAt'],
      'createdAt',
    );

    const [transactions, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy,
        take: pagination.take,
        skip: pagination.skip,
        include: {
          customer: {
            select: senderCustomerSelect,
          },
        },
      }),
      delegate.count({ where }),
    ]);

    sendPaginatedJson(res, { data: transactions, total, pagination });
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

    if (/@remittance\.pending$/i.test(recipientEmail) || /^phone_\d+@/i.test(recipientEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Customer does not have a valid email address on file. Ask them to add an email in the app profile.',
      });
    }

    if (!isSmtpConfigured()) {
      return res.status(503).json({
        success: false,
        message:
          'Email is not configured on the server. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in the backend .env file.',
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
    const US_STATE_TZ = {
      AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix',
      AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
      CT: 'America/New_York', DC: 'America/New_York', DE: 'America/New_York',
      FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
      IA: 'America/Chicago', ID: 'America/Boise', IL: 'America/Chicago',
      IN: 'America/Indiana/Indianapolis', KS: 'America/Chicago', KY: 'America/New_York',
      LA: 'America/Chicago', MA: 'America/New_York', MD: 'America/New_York',
      ME: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
      MO: 'America/Chicago', MS: 'America/Chicago', MT: 'America/Denver',
      NC: 'America/New_York', ND: 'America/Chicago', NE: 'America/Chicago',
      NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
      NV: 'America/Los_Angeles', NY: 'America/New_York', OH: 'America/New_York',
      OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York',
      RI: 'America/New_York', SC: 'America/New_York', SD: 'America/Chicago',
      TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
      VA: 'America/New_York', VT: 'America/New_York', WA: 'America/Los_Angeles',
      WI: 'America/Chicago', WV: 'America/New_York', WY: 'America/Denver',
    };
    const resolveZone = (countryOrCurrency, region) => {
      const raw = String(countryOrCurrency || '').trim();
      const regionCode = String(region || '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
      const isUs =
        !raw ||
        /^(us|usa|united states|usd)$/i.test(raw) ||
        Boolean(regionCode && US_STATE_TZ[regionCode]);
      if (isUs || /united states/i.test(raw)) {
        return { timeZone: (regionCode && US_STATE_TZ[regionCode]) || 'America/Chicago' };
      }
      const key = raw.toLowerCase();
      const table = [
        { match: /^(pk|pak|pakistan|pkr)$/i, timeZone: 'Asia/Karachi', label: 'PKT' },
        { match: /^(in|ind|india|inr)$/i, timeZone: 'Asia/Kolkata', label: 'IST' },
        { match: /^(et|eth|ethiopia|etb)$/i, timeZone: 'Africa/Addis_Ababa', label: 'EAT' },
        { match: /^(so|som|somalia|sos)$/i, timeZone: 'Africa/Mogadishu', label: 'EAT' },
        { match: /^(ke|ken|kenya|kes)$/i, timeZone: 'Africa/Nairobi', label: 'EAT' },
        { match: /^(ng|nga|nigeria|ngn)$/i, timeZone: 'Africa/Lagos', label: 'WAT' },
        { match: /^(gb|uk|united kingdom)$/i, timeZone: 'Europe/London' },
        { match: /^(ca|can|canada)$/i, timeZone: 'America/Toronto' },
        { match: /^(mx|mex|mexico|mxn)$/i, timeZone: 'America/Mexico_City' },
        { match: /^(ae|uae|aed)$/i, timeZone: 'Asia/Dubai', label: 'GST' },
      ];
      for (const row of table) {
        if (row.match.test(key) || row.match.test(raw)) {
          return { timeZone: row.timeZone, label: row.label };
        }
      }
      return { timeZone: 'UTC', label: 'UTC' };
    };
    const formatInZone = (value, timeZone, forcedLabel) => {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      }).formatToParts(date);
      const get = (type) => parts.find((p) => p.type === type)?.value || '';
      let zone =
        forcedLabel ||
        String(get('timeZoneName') || '')
          .replace(/\bGMT\b/i, 'UTC')
          .trim();
      if (!forcedLabel) {
        if (/^GMT\+5$/i.test(zone) && timeZone === 'Asia/Karachi') zone = 'PKT';
        if (/^GMT\+5:?30$/i.test(zone) && timeZone === 'Asia/Kolkata') zone = 'IST';
        if (/^GMT\+3$/i.test(zone) && /Addis_Ababa|Nairobi|Mogadishu/.test(timeZone)) zone = 'EAT';
        if (/^(GMT|UTC)\+1$/i.test(zone) && timeZone === 'Europe/London') zone = 'BST';
        if (/^(GMT|UTC)$/i.test(zone) && timeZone === 'Europe/London') zone = 'GMT';
      }
      return `${get('month')} ${get('day')}, ${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${zone}`.trim();
    };
    const senderZone = resolveZone(
      transaction.customer?.country || 'United States',
      transaction.customer?.region ||
        paymentFields.sendersState ||
        paymentFields.senderState,
    );
    const createdAt =
      formatInZone(transaction.createdAt, senderZone.timeZone, senderZone.label) || '—';
    const delivered =
      String(status).toLowerCase() === 'completed'
        ? transaction.updatedAt || transaction.createdAt
        : null;
    const formatDateOnly = (value, timeZone) => {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).formatToParts(date);
      const get = (type) => parts.find((p) => p.type === type)?.value || '';
      return `${get('month')} ${get('day')}, ${get('year')}`.trim();
    };
    const receiverZone = resolveZone(
      recipientInfo.receivingBranchCountryName ||
        recipientInfo.countryName ||
        recipientInfo.country ||
        recipientInfo.countryCode ||
        currency,
      null,
    );
    let paidAt = '---------';
    if (delivered) {
      const senderLine = formatInZone(delivered, senderZone.timeZone, senderZone.label);
      const receiverDate = formatDateOnly(delivered, receiverZone.timeZone);
      paidAt =
        senderLine && receiverDate && senderZone.timeZone !== receiverZone.timeZone
          ? `${senderLine}<br/>${receiverDate}`
          : senderLine || '---------';
    }
    const serviceType = transaction.transferType === 'wallet' ? 'Wallet Transfer' : 'Bank Transfer';
    const receiptSettings = await getReceiptSettingsValues();
    const senderCountry = String(
      transaction.customer?.country ||
      paymentFields.sendingBranchCountryName ||
      recipientInfo.sendingBranchCountryName ||
      recipientInfo.countryName ||
      '—'
    );
    const senderAddress = (() => {
      const street = String(
        paymentFields.senderAddress ||
          paymentFields.address ||
          recipientInfo.senderAddress ||
          transaction.customer?.address ||
          '',
      ).trim();
      const city = String(transaction.customer?.city || paymentFields.senderCity || '').trim();
      const region = String(
        paymentFields.sendersState ||
          paymentFields.senderState ||
          recipientInfo.senderState ||
          transaction.customer?.region ||
          '',
      ).trim();
      const zip = String(transaction.customer?.zipCode || paymentFields.senderPostcode || '').trim();
      const country = String(transaction.customer?.country || '').trim();
      const streetNorm = street.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
      const contains = (piece) => {
        const n = String(piece || '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
        return Boolean(n) && streetNorm.includes(n);
      };
      const cluster = [city, region, zip].filter(Boolean).join(', ');
      const extras = [];
      if (cluster && !contains(cluster)) {
        const missing = [city, region, zip].filter((p) => p && !contains(p));
        if (missing.length) extras.push(missing.join(', '));
      }
      if (country && !contains(country)) extras.push(country);
      const formatted = [street, ...extras].filter(Boolean).join(', ');
      return formatted || '—';
    })();
    const senderState = String(
      transaction.customer?.region ||
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
    const stateDisclosureText = await getStateDisclosureText(senderState, senderCountry);
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
                <div style="padding:8px 14px;"><strong>Available</strong><span style="float:right;text-align:right;">${paidAt}</span></div>
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
    const isAuthError =
      error?.code === 'EAUTH' ||
      String(error?.message || '').includes('535') ||
      String(error?.message || '').toLowerCase().includes('authentication unsuccessful');
    return res.status(500).json({
      success: false,
      message: isAuthError
        ? 'SMTP authentication failed. For Outlook/Microsoft 365, use an app password, enable Authenticated SMTP for the mailbox, and set SMTP_HOST=smtp.office365.com with SMTP_PORT=587 in backend .env.'
        : error.message || 'Failed to send transaction receipt',
    });
  }
};
