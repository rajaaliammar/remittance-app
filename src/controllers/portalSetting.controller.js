import { randomUUID } from 'crypto';
import prisma from '../utils/prisma.js';

const DEFAULT_PORTAL_SETTINGS = {
  brandName: 'BrandPay',
  brandMark: 'B',
  logoUrl: '',
  faviconUrl: '',
  primaryColor: '#2563EB',
  defaultThemeMode: 'light',
};

const FIELD_KEYS = Object.keys(DEFAULT_PORTAL_SETTINGS);

const ensurePortalSettingsTable = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "portal_settings" (
      "id" TEXT NOT NULL,
      "brandName" TEXT NOT NULL DEFAULT 'BrandPay',
      "brandMark" TEXT NOT NULL DEFAULT 'B',
      "logoUrl" TEXT NOT NULL DEFAULT '',
      "faviconUrl" TEXT NOT NULL DEFAULT '',
      "primaryColor" TEXT NOT NULL DEFAULT '#2563EB',
      "defaultThemeMode" TEXT NOT NULL DEFAULT 'light',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "portal_settings_pkey" PRIMARY KEY ("id")
    )
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "portal_settings" ADD COLUMN IF NOT EXISTS "primaryColor" TEXT NOT NULL DEFAULT '#2563EB'
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "portal_settings" ADD COLUMN IF NOT EXISTS "defaultThemeMode" TEXT NOT NULL DEFAULT 'light'
  `);
};

const normalizeSettings = (raw) => {
  const out = {};
  FIELD_KEYS.forEach((key) => {
    const value = raw?.[key];
    out[key] = value == null ? DEFAULT_PORTAL_SETTINGS[key] : String(value);
  });
  if (!out.brandMark.trim()) out.brandMark = DEFAULT_PORTAL_SETTINGS.brandMark;
  if (!out.brandName.trim()) out.brandName = DEFAULT_PORTAL_SETTINGS.brandName;
  if (!/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(out.primaryColor)) {
    out.primaryColor = DEFAULT_PORTAL_SETTINGS.primaryColor;
  }
  out.defaultThemeMode = out.defaultThemeMode === 'dark' ? 'dark' : 'light';
  return out;
};

const sanitizeInput = (input = {}) => {
  const out = {};
  FIELD_KEYS.forEach((key) => {
    if (input[key] !== undefined) out[key] = String(input[key] ?? '');
  });
  return out;
};

const getFirstPortalSettingsRow = async () => {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT * FROM "portal_settings"
    ORDER BY "createdAt" ASC
    LIMIT 1
  `);
  return rows?.[0] || null;
};

const createDefaultSettingsRow = async () => {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "portal_settings" (
        "id", "brandName", "brandMark", "logoUrl", "faviconUrl", "primaryColor", "defaultThemeMode", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    `,
    id,
    DEFAULT_PORTAL_SETTINGS.brandName,
    DEFAULT_PORTAL_SETTINGS.brandMark,
    DEFAULT_PORTAL_SETTINGS.logoUrl,
    DEFAULT_PORTAL_SETTINGS.faviconUrl,
    DEFAULT_PORTAL_SETTINGS.primaryColor,
    DEFAULT_PORTAL_SETTINGS.defaultThemeMode,
  );
};

const getOrCreatePortalSettings = async () => {
  await ensurePortalSettingsTable();
  let row = await getFirstPortalSettingsRow();
  if (!row) {
    await createDefaultSettingsRow();
    row = await getFirstPortalSettingsRow();
  }
  return row;
};

export const getPortalSettingsValues = async () => {
  try {
    const row = await getOrCreatePortalSettings();
    return normalizeSettings(row);
  } catch (error) {
    console.error('Error loading portal settings values:', error);
    return { ...DEFAULT_PORTAL_SETTINGS };
  }
};

export const getPortalSettings = async (_req, res) => {
  try {
    const data = await getPortalSettingsValues();
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching portal settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch portal settings',
      error: error.message,
    });
  }
};

export const getPublicPortalSettings = async (_req, res) => {
  return getPortalSettings(_req, res);
};

export const updatePortalSettings = async (req, res) => {
  try {
    const currentRow = await getOrCreatePortalSettings();
    const current = normalizeSettings(currentRow);
    const updates = sanitizeInput(req.body || {});
    const next = { ...current, ...updates };

    await prisma.$executeRawUnsafe(
      `
        UPDATE "portal_settings"
        SET "brandName" = $1,
            "brandMark" = $2,
            "logoUrl" = $3,
            "faviconUrl" = $4,
            "primaryColor" = $5,
            "defaultThemeMode" = $6,
            "updatedAt" = NOW()
        WHERE "id" = $7
      `,
      next.brandName,
      next.brandMark.slice(0, 3),
      next.logoUrl,
      next.faviconUrl,
      next.primaryColor,
      next.defaultThemeMode,
      currentRow.id,
    );

    return res.json({
      success: true,
      message: 'Portal branding updated successfully',
      data: next,
    });
  } catch (error) {
    console.error('Error updating portal settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update portal settings',
      error: error.message,
    });
  }
};
