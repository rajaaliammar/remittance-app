import prisma from '../utils/prisma.js';

let tableReady = false;

async function ensureSavedRecipientsTable() {
  if (tableReady) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "saved_recipients" (
        "id" TEXT NOT NULL,
        "customerId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "accountNumber" TEXT NOT NULL,
        "phone" TEXT,
        "countryId" TEXT,
        "countryCode" TEXT,
        "countryName" TEXT,
        "bankId" TEXT,
        "walletId" TEXT,
        "serviceProvider" TEXT,
        "transferType" TEXT NOT NULL DEFAULT 'bank',
        "lastSentAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "saved_recipients_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "saved_recipients_customerId_idx"
      ON "saved_recipients" ("customerId")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "saved_recipients_customerId_updatedAt_idx"
      ON "saved_recipients" ("customerId", "updatedAt")
    `);
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'saved_recipients_customerId_fkey'
        ) THEN
          ALTER TABLE "saved_recipients"
          ADD CONSTRAINT "saved_recipients_customerId_fkey"
          FOREIGN KEY ("customerId")
          REFERENCES "customers"("id")
          ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    // Unique per customer + account + type + bank (bankId may be null → coalesce)
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "saved_recipients_dedupe_idx"
      ON "saved_recipients" (
        "customerId",
        "accountNumber",
        "transferType",
        COALESCE("bankId", ''),
        COALESCE("walletId", '')
      )
    `);
    tableReady = true;
  } catch (e) {
    console.warn('ensureSavedRecipientsTable:', e.message);
  }
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeTransferType(value) {
  const t = String(value || 'bank').toLowerCase();
  if (t === 'wallet') return 'wallet';
  if (t === 'cash') return 'cash';
  return 'bank';
}

function shapeRecipient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    accountNumber: row.accountNumber,
    phone: row.phone || undefined,
    countryId: row.countryId || undefined,
    countryCode: row.countryCode
      ? String(row.countryCode).toUpperCase()
      : undefined,
    countryName: row.countryName || undefined,
    bankId: row.bankId || undefined,
    walletId: row.walletId || undefined,
    serviceProvider: row.serviceProvider || undefined,
    transferType: normalizeTransferType(row.transferType),
    lastSentAt: row.lastSentAt || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * GET /api/accounts/recipients
 */
export const listSavedRecipients = async (req, res) => {
  try {
    await ensureSavedRecipientsTable();
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Backfill from past sends so Recipients is populated for existing users
    try {
      const existingCount = await prisma.savedRecipient.count({ where: { customerId } });
      if (existingCount < 40) {
        const txs = await prisma.remittanceTransaction.findMany({
          where: {
            customerId,
            type: 'Sent',
            status: {
              notIn: ['Failed', 'Cancelled', 'Canceled', 'Refunded', 'Rejected'],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: { recipientInfo: true, transferType: true, createdAt: true },
        });
        const seen = new Set();
        const jobs = [];
        for (const tx of txs) {
          const ri =
            tx.recipientInfo && typeof tx.recipientInfo === 'object'
              ? tx.recipientInfo
              : {};
          const accountNumber = digits(ri.accountNumber || ri.phone || '');
          const key = `${accountNumber}|${normalizeTransferType(tx.transferType || ri.transferType)}|${ri.bankId || ''}`;
          if (!accountNumber || seen.has(key)) continue;
          seen.add(key);
          jobs.push(
            upsertSavedRecipientFromSend(customerId, {
              ...ri,
              transferType: tx.transferType || ri.transferType,
            })
          );
          if (jobs.length >= 15) break;
        }
        if (jobs.length) await Promise.all(jobs);
      }
    } catch (syncErr) {
      console.warn('listSavedRecipients sync:', syncErr.message);
    }

    const q = String(req.query.search || req.query.q || '').trim().toLowerCase();
    const rows = await prisma.savedRecipient.findMany({
      where: { customerId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    let data = rows.map(shapeRecipient).filter(Boolean);
    if (q) {
      data = data.filter((r) => {
        const hay = [
          r.name,
          r.countryCode,
          r.countryName,
          r.accountNumber,
          r.serviceProvider,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    return res.json({ success: true, data });
  } catch (error) {
    console.error('listSavedRecipients:', error);
    // Fallback if Prisma client not regenerated yet
    if (String(error.message || '').includes('savedRecipient')) {
      return res.json({ success: true, data: [] });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/accounts/recipients
 * Body: { name, accountNumber, phone?, countryId?, countryCode?, countryName?,
 *         bankId?, walletId?, serviceProvider?, transferType? }
 */
export const createSavedRecipient = async (req, res) => {
  try {
    await ensureSavedRecipientsTable();
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const body = req.body || {};
    const name = String(body.name || body.accountHolderName || '').trim();
    const accountNumber = digits(body.accountNumber || body.phone || '');
    if (!name) {
      return res.status(400).json({ success: false, message: 'Recipient name is required' });
    }
    if (!accountNumber) {
      return res.status(400).json({ success: false, message: 'Account number is required' });
    }

    const transferType = normalizeTransferType(body.transferType);
    const bankId = body.bankId ? String(body.bankId) : null;
    const walletId = body.walletId ? String(body.walletId) : null;
    const phone = body.phone ? String(body.phone).trim() : accountNumber;
    const countryId = body.countryId ? String(body.countryId) : null;
    const countryCode = body.countryCode
      ? String(body.countryCode).trim().toUpperCase()
      : null;
    const countryName = body.countryName ? String(body.countryName).trim() : null;
    const serviceProvider = body.serviceProvider
      ? String(body.serviceProvider).trim()
      : body.bankName
        ? String(body.bankName).trim()
        : null;

    // Upsert by account + type + provider
    const existing = await prisma.savedRecipient.findFirst({
      where: {
        customerId,
        accountNumber,
        transferType,
        ...(bankId ? { bankId } : { bankId: null }),
        ...(walletId ? { walletId } : {}),
      },
    });

    let row;
    if (existing) {
      row = await prisma.savedRecipient.update({
        where: { id: existing.id },
        data: {
          name,
          phone,
          countryId,
          countryCode,
          countryName,
          bankId,
          walletId,
          serviceProvider,
          transferType,
          updatedAt: new Date(),
        },
      });
    } else {
      row = await prisma.savedRecipient.create({
        data: {
          customerId,
          name,
          accountNumber,
          phone,
          countryId,
          countryCode,
          countryName,
          bankId,
          walletId,
          serviceProvider,
          transferType,
        },
      });
    }

    return res.status(existing ? 200 : 201).json({
      success: true,
      data: shapeRecipient(row),
      message: existing ? 'Recipient updated' : 'Recipient saved',
    });
  } catch (error) {
    console.error('createSavedRecipient:', error);
    if (String(error.message || '').includes('savedRecipient')) {
      return res.status(503).json({
        success: false,
        message: 'Recipients table not ready. Restart backend after prisma generate.',
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/accounts/recipients/:id
 */
export const deleteSavedRecipient = async (req, res) => {
  try {
    await ensureSavedRecipientsTable();
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: 'Recipient id is required' });
    }

    const existing = await prisma.savedRecipient.findFirst({
      where: { id, customerId },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Recipient not found' });
    }

    await prisma.savedRecipient.delete({ where: { id } });
    return res.json({ success: true, message: 'Recipient deleted' });
  } catch (error) {
    console.error('deleteSavedRecipient:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Upsert from a completed send (used by transaction create / mobile client).
 */
export async function upsertSavedRecipientFromSend(customerId, recipientInfo = {}) {
  if (!customerId) return null;
  try {
    await ensureSavedRecipientsTable();
    const name = String(
      recipientInfo.accountHolderName ||
        recipientInfo.recipientName ||
        recipientInfo.name ||
        ''
    ).trim();
    const accountNumber = digits(
      recipientInfo.accountNumber || recipientInfo.phone || ''
    );
    if (!name || !accountNumber) return null;

    const transferType = normalizeTransferType(recipientInfo.transferType);
    const bankId = recipientInfo.bankId ? String(recipientInfo.bankId) : null;
    const walletId = recipientInfo.walletId
      ? String(recipientInfo.walletId)
      : null;

    const existing = await prisma.savedRecipient.findFirst({
      where: {
        customerId,
        accountNumber,
        transferType,
        ...(bankId ? { bankId } : { bankId: null }),
      },
    });

    const data = {
      name,
      phone: String(recipientInfo.phone || accountNumber),
      countryId: recipientInfo.countryId
        ? String(recipientInfo.countryId)
        : null,
      countryCode: recipientInfo.countryCode
        ? String(recipientInfo.countryCode).toUpperCase()
        : null,
      countryName: recipientInfo.countryName
        ? String(recipientInfo.countryName)
        : null,
      bankId,
      walletId,
      serviceProvider: String(
        recipientInfo.serviceProvider || recipientInfo.bankName || ''
      ).trim() || null,
      transferType,
      lastSentAt: new Date(),
      updatedAt: new Date(),
    };

    if (existing) {
      return prisma.savedRecipient.update({
        where: { id: existing.id },
        data,
      });
    }

    return prisma.savedRecipient.create({
      data: {
        customerId,
        accountNumber,
        ...data,
      },
    });
  } catch (e) {
    console.warn('upsertSavedRecipientFromSend:', e.message);
    return null;
  }
}
