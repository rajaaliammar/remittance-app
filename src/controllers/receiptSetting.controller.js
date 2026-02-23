import { randomUUID } from 'crypto';
import prisma from '../utils/prisma.js';

const DEFAULT_RECEIPT_SETTINGS = {
  brandName: 'PaySii',
  brandSubTitle: 'Powered by Beeso',
  logoUrl: '',
  companyAddress: 'Addis Ababa, Ethiopia',
  companyPhone: '+251 000 000 000',
  companyEmail: 'support@paysii.com',
  receiptTitle: 'Payment Receipt - Customer Copy',
  noteText: 'This receipt is not a proof that funds have reached the receiver.',
  disclosureTitle: 'Disclosure',
  disclosureText:
    'Please contact us if you have questions about this transaction.\nImportant information about our refund policy is available here.',
  mobileRightsTitle: 'Your Consumer Rights',
  mobileRightsIntro:
    'Please contact us if you have questions about this transaction. Important information about our refund policy is available here.',
  mobileScamTitle: 'Be Wary of Internet Scams',
  mobileScamBullets:
    'DO NOT make a payment to claim lottery or prize winnings, or on a promise of receiving a large amount of money.\nDO NOT respond to an Internet or phone offer that you aren\'t sure is honest.\nDO NOT make a payment to someone you don\'t know or whose identity you can\'t verify.',
  mobileRightsFooter:
    'You can cancel for a full refund anytime unless the funds have been picked up or deposited.',
  mobilePdfLogoUrl: '',
  mobilePdfBrandName: 'PaySii',
  mobilePdfBrandSubTitle: 'Powered by Beeso',
  mobilePdfReceiptTitle: 'Payment Receipt',
  mobilePdfCompanyAddress: 'Addis Ababa, Ethiopia',
  mobilePdfCompanyPhone: '+251 000 000 000',
  mobilePdfCompanyEmail: 'support@paysii.com',
  mobilePdfNoteText: 'This receipt is not a proof that funds have reached the receiver.',
};

const FIELD_KEYS = Object.keys(DEFAULT_RECEIPT_SETTINGS);

const ensureReceiptSettingsTable = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "receipt_settings" (
      "id" TEXT NOT NULL,
      "brandName" TEXT NOT NULL DEFAULT 'PaySii',
      "brandSubTitle" TEXT NOT NULL DEFAULT 'Powered by Beeso',
      "logoUrl" TEXT NOT NULL DEFAULT '',
      "companyAddress" TEXT NOT NULL DEFAULT 'Addis Ababa, Ethiopia',
      "companyPhone" TEXT NOT NULL DEFAULT '+251 000 000 000',
      "companyEmail" TEXT NOT NULL DEFAULT 'support@paysii.com',
      "receiptTitle" TEXT NOT NULL DEFAULT 'Payment Receipt - Customer Copy',
      "noteText" TEXT NOT NULL DEFAULT 'This receipt is not a proof that funds have reached the receiver.',
      "disclosureTitle" TEXT NOT NULL DEFAULT 'Disclosure',
      "disclosureText" TEXT NOT NULL DEFAULT 'Please contact us if you have questions about this transaction.',
      "mobileRightsTitle" TEXT NOT NULL DEFAULT 'Your Consumer Rights',
      "mobileRightsIntro" TEXT NOT NULL DEFAULT 'Please contact us if you have questions about this transaction.',
      "mobileScamTitle" TEXT NOT NULL DEFAULT 'Be Wary of Internet Scams',
      "mobileScamBullets" TEXT NOT NULL DEFAULT 'DO NOT make a payment to claim lottery or prize winnings, or on a promise of receiving a large amount of money.' || chr(10) || 'DO NOT respond to an Internet or phone offer that you aren''t sure is honest.' || chr(10) || 'DO NOT make a payment to someone you don''t know or whose identity you can''t verify.',
      "mobileRightsFooter" TEXT NOT NULL DEFAULT 'You can cancel for a full refund anytime unless the funds have been picked up or deposited.',
      "mobilePdfLogoUrl" TEXT NOT NULL DEFAULT '',
      "mobilePdfBrandName" TEXT NOT NULL DEFAULT 'PaySii',
      "mobilePdfBrandSubTitle" TEXT NOT NULL DEFAULT 'Powered by Beeso',
      "mobilePdfReceiptTitle" TEXT NOT NULL DEFAULT 'Payment Receipt',
      "mobilePdfCompanyAddress" TEXT NOT NULL DEFAULT 'Addis Ababa, Ethiopia',
      "mobilePdfCompanyPhone" TEXT NOT NULL DEFAULT '+251 000 000 000',
      "mobilePdfCompanyEmail" TEXT NOT NULL DEFAULT 'support@paysii.com',
      "mobilePdfNoteText" TEXT NOT NULL DEFAULT 'This receipt is not a proof that funds have reached the receiver.',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "receipt_settings_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "receipt_settings"
    ADD COLUMN IF NOT EXISTS "mobilePdfLogoUrl" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "mobilePdfBrandName" TEXT NOT NULL DEFAULT 'PaySii',
    ADD COLUMN IF NOT EXISTS "mobilePdfBrandSubTitle" TEXT NOT NULL DEFAULT 'Powered by Beeso',
    ADD COLUMN IF NOT EXISTS "mobilePdfReceiptTitle" TEXT NOT NULL DEFAULT 'Payment Receipt',
    ADD COLUMN IF NOT EXISTS "mobilePdfCompanyAddress" TEXT NOT NULL DEFAULT 'Addis Ababa, Ethiopia',
    ADD COLUMN IF NOT EXISTS "mobilePdfCompanyPhone" TEXT NOT NULL DEFAULT '+251 000 000 000',
    ADD COLUMN IF NOT EXISTS "mobilePdfCompanyEmail" TEXT NOT NULL DEFAULT 'support@paysii.com',
    ADD COLUMN IF NOT EXISTS "mobilePdfNoteText" TEXT NOT NULL DEFAULT 'This receipt is not a proof that funds have reached the receiver.'
  `);
};

const normalizeSettings = (raw) => {
  const out = {};
  FIELD_KEYS.forEach((key) => {
    let value = raw?.[key];
    if (key === 'mobileScamBullets' && (value == null || String(value).indexOf('\n') === -1)) {
      value = DEFAULT_RECEIPT_SETTINGS.mobileScamBullets;
    }
    out[key] = value == null ? DEFAULT_RECEIPT_SETTINGS[key] : String(value);
  });
  return out;
};

const sanitizeInput = (input = {}) => {
  const out = {};
  FIELD_KEYS.forEach((key) => {
    if (input[key] !== undefined) out[key] = String(input[key] ?? '');
  });
  return out;
};

const getFirstReceiptSettingsRow = async () => {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT * FROM "receipt_settings"
    ORDER BY "createdAt" ASC
    LIMIT 1
  `);
  return rows?.[0] || null;
};

const createDefaultSettingsRow = async () => {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "receipt_settings" (
        "id", "brandName", "brandSubTitle", "logoUrl", "companyAddress",
        "companyPhone", "companyEmail", "receiptTitle", "noteText",
        "disclosureTitle", "disclosureText", "mobileRightsTitle",
        "mobileRightsIntro", "mobileScamTitle", "mobileScamBullets",
        "mobileRightsFooter", "mobilePdfLogoUrl", "mobilePdfBrandName",
        "mobilePdfBrandSubTitle", "mobilePdfReceiptTitle", "mobilePdfCompanyAddress",
        "mobilePdfCompanyPhone", "mobilePdfCompanyEmail", "mobilePdfNoteText",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW()
      )
    `,
    id,
    DEFAULT_RECEIPT_SETTINGS.brandName,
    DEFAULT_RECEIPT_SETTINGS.brandSubTitle,
    DEFAULT_RECEIPT_SETTINGS.logoUrl,
    DEFAULT_RECEIPT_SETTINGS.companyAddress,
    DEFAULT_RECEIPT_SETTINGS.companyPhone,
    DEFAULT_RECEIPT_SETTINGS.companyEmail,
    DEFAULT_RECEIPT_SETTINGS.receiptTitle,
    DEFAULT_RECEIPT_SETTINGS.noteText,
    DEFAULT_RECEIPT_SETTINGS.disclosureTitle,
    DEFAULT_RECEIPT_SETTINGS.disclosureText,
    DEFAULT_RECEIPT_SETTINGS.mobileRightsTitle,
    DEFAULT_RECEIPT_SETTINGS.mobileRightsIntro,
    DEFAULT_RECEIPT_SETTINGS.mobileScamTitle,
    DEFAULT_RECEIPT_SETTINGS.mobileScamBullets,
    DEFAULT_RECEIPT_SETTINGS.mobileRightsFooter,
    DEFAULT_RECEIPT_SETTINGS.mobilePdfLogoUrl,
    DEFAULT_RECEIPT_SETTINGS.mobilePdfBrandName,
    DEFAULT_RECEIPT_SETTINGS.mobilePdfBrandSubTitle,
    DEFAULT_RECEIPT_SETTINGS.mobilePdfReceiptTitle,
    DEFAULT_RECEIPT_SETTINGS.mobilePdfCompanyAddress,
    DEFAULT_RECEIPT_SETTINGS.mobilePdfCompanyPhone,
    DEFAULT_RECEIPT_SETTINGS.mobilePdfCompanyEmail,
    DEFAULT_RECEIPT_SETTINGS.mobilePdfNoteText,
  );
};

const getOrCreateReceiptSettings = async () => {
  await ensureReceiptSettingsTable();
  let row = await getFirstReceiptSettingsRow();
  if (!row) {
    await createDefaultSettingsRow();
    row = await getFirstReceiptSettingsRow();
  }
  return row;
};

export const getReceiptSettingsValues = async () => {
  try {
    const row = await getOrCreateReceiptSettings();
    return normalizeSettings(row);
  } catch (error) {
    console.error('Error loading receipt settings values:', error);
    return { ...DEFAULT_RECEIPT_SETTINGS };
  }
};

export const getReceiptSettings = async (_req, res) => {
  try {
    const data = await getReceiptSettingsValues();
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching receipt settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch receipt settings',
      error: error.message,
    });
  }
};

export const updateReceiptSettings = async (req, res) => {
  try {
    const currentRow = await getOrCreateReceiptSettings();
    const current = normalizeSettings(currentRow);
    const updates = sanitizeInput(req.body || {});
    const next = { ...current, ...updates };

    await prisma.$executeRawUnsafe(
      `
        UPDATE "receipt_settings"
        SET "brandName" = $1,
            "brandSubTitle" = $2,
            "logoUrl" = $3,
            "companyAddress" = $4,
            "companyPhone" = $5,
            "companyEmail" = $6,
            "receiptTitle" = $7,
            "noteText" = $8,
            "disclosureTitle" = $9,
            "disclosureText" = $10,
            "mobileRightsTitle" = $11,
            "mobileRightsIntro" = $12,
            "mobileScamTitle" = $13,
            "mobileScamBullets" = $14,
            "mobileRightsFooter" = $15,
            "mobilePdfLogoUrl" = $16,
            "mobilePdfBrandName" = $17,
            "mobilePdfBrandSubTitle" = $18,
            "mobilePdfReceiptTitle" = $19,
            "mobilePdfCompanyAddress" = $20,
            "mobilePdfCompanyPhone" = $21,
            "mobilePdfCompanyEmail" = $22,
            "mobilePdfNoteText" = $23,
            "updatedAt" = NOW()
        WHERE "id" = $24
      `,
      next.brandName,
      next.brandSubTitle,
      next.logoUrl,
      next.companyAddress,
      next.companyPhone,
      next.companyEmail,
      next.receiptTitle,
      next.noteText,
      next.disclosureTitle,
      next.disclosureText,
      next.mobileRightsTitle,
      next.mobileRightsIntro,
      next.mobileScamTitle,
      next.mobileScamBullets,
      next.mobileRightsFooter,
      next.mobilePdfLogoUrl,
      next.mobilePdfBrandName,
      next.mobilePdfBrandSubTitle,
      next.mobilePdfReceiptTitle,
      next.mobilePdfCompanyAddress,
      next.mobilePdfCompanyPhone,
      next.mobilePdfCompanyEmail,
      next.mobilePdfNoteText,
      currentRow.id,
    );

    return res.json({
      success: true,
      message: 'Receipt settings updated successfully',
      data: next,
    });
  } catch (error) {
    console.error('Error updating receipt settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update receipt settings',
      error: error.message,
    });
  }
};

