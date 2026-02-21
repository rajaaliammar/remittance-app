import { randomUUID } from 'crypto';
import prisma from '../utils/prisma.js';

const ensureStateDisclosuresTable = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "state_disclosures" (
      "id" TEXT NOT NULL,
      "stateInitial" TEXT NOT NULL,
      "stateName" TEXT NOT NULL,
      "institution" TEXT NOT NULL DEFAULT '',
      "phone" TEXT NOT NULL DEFAULT '',
      "website" TEXT NOT NULL DEFAULT '',
      "email" TEXT NOT NULL DEFAULT '',
      "address" TEXT NOT NULL DEFAULT '',
      "disclosureText" TEXT NOT NULL DEFAULT '',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "state_disclosures_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "state_disclosures_stateInitial_key"
    ON "state_disclosures" ("stateInitial")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "state_disclosures_stateName_key"
    ON "state_disclosures" ("stateName")
  `);
};

const normalizeStateInitial = (value) => String(value || '').trim().toUpperCase();
const normalizeText = (value) => String(value || '').trim();

const toDisclosurePayload = (input = {}) => ({
  stateInitial: normalizeStateInitial(input.stateInitial),
  stateName: normalizeText(input.stateName),
  institution: normalizeText(input.institution),
  phone: normalizeText(input.phone),
  website: normalizeText(input.website),
  email: normalizeText(input.email),
  address: normalizeText(input.address),
  disclosureText: normalizeText(input.disclosureText),
});

const validatePayload = (payload) => {
  if (!payload.stateInitial || !/^[A-Z]{2}$/.test(payload.stateInitial)) {
    return 'State initials must be exactly 2 letters (e.g. CA, TX).';
  }
  if (!payload.stateName) return 'State name is required.';
  if (!payload.disclosureText) return 'Disclosure text is required.';
  return null;
};

const findDuplicate = async (payload, excludeId = null) => {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT "id", "stateInitial", "stateName"
      FROM "state_disclosures"
      WHERE (
        UPPER(TRIM("stateInitial")) = UPPER(TRIM($1))
        OR LOWER(TRIM("stateName")) = LOWER(TRIM($2))
      )
      ${excludeId ? 'AND "id" <> $3' : ''}
      LIMIT 1
    `,
    ...(excludeId ? [payload.stateInitial, payload.stateName, excludeId] : [payload.stateInitial, payload.stateName]),
  );
  return rows?.[0] || null;
};

export const listStateDisclosures = async (_req, res) => {
  try {
    await ensureStateDisclosuresTable();
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        "id",
        "stateInitial",
        "stateName",
        "institution",
        "phone",
        "website",
        "email",
        "address",
        "disclosureText",
        "createdAt",
        "updatedAt"
      FROM "state_disclosures"
      ORDER BY "stateInitial" ASC
    `);
    return res.json({ success: true, data: rows || [] });
  } catch (error) {
    console.error('Error listing state disclosures:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch state disclosures',
      error: error.message,
    });
  }
};

export const createStateDisclosure = async (req, res) => {
  try {
    await ensureStateDisclosuresTable();
    const payload = toDisclosurePayload(req.body || {});
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const duplicate = await findDuplicate(payload);
    if (duplicate) {
      const duplicateField =
        normalizeStateInitial(duplicate.stateInitial) === payload.stateInitial ? 'state initials' : 'state name';
      return res.status(409).json({
        success: false,
        message: `Duplicate ${duplicateField}. State initials and state name must be unique.`,
      });
    }

    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "state_disclosures" (
          "id", "stateInitial", "stateName", "institution", "phone",
          "website", "email", "address", "disclosureText", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
        )
      `,
      id,
      payload.stateInitial,
      payload.stateName,
      payload.institution,
      payload.phone,
      payload.website,
      payload.email,
      payload.address,
      payload.disclosureText,
    );

    return res.status(201).json({
      success: true,
      message: 'State disclosure created successfully',
      data: { id, ...payload },
    });
  } catch (error) {
    console.error('Error creating state disclosure:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create state disclosure',
      error: error.message,
    });
  }
};

export const updateStateDisclosure = async (req, res) => {
  try {
    await ensureStateDisclosuresTable();
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'ID is required' });

    const payload = toDisclosurePayload(req.body || {});
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const duplicate = await findDuplicate(payload, id);
    if (duplicate) {
      const duplicateField =
        normalizeStateInitial(duplicate.stateInitial) === payload.stateInitial ? 'state initials' : 'state name';
      return res.status(409).json({
        success: false,
        message: `Duplicate ${duplicateField}. State initials and state name must be unique.`,
      });
    }

    const result = await prisma.$executeRawUnsafe(
      `
        UPDATE "state_disclosures"
        SET
          "stateInitial" = $1,
          "stateName" = $2,
          "institution" = $3,
          "phone" = $4,
          "website" = $5,
          "email" = $6,
          "address" = $7,
          "disclosureText" = $8,
          "updatedAt" = NOW()
        WHERE "id" = $9
      `,
      payload.stateInitial,
      payload.stateName,
      payload.institution,
      payload.phone,
      payload.website,
      payload.email,
      payload.address,
      payload.disclosureText,
      id,
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'State disclosure not found' });
    }

    return res.json({
      success: true,
      message: 'State disclosure updated successfully',
      data: { id, ...payload },
    });
  } catch (error) {
    console.error('Error updating state disclosure:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update state disclosure',
      error: error.message,
    });
  }
};

export const deleteStateDisclosure = async (req, res) => {
  try {
    await ensureStateDisclosuresTable();
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'ID is required' });

    const result = await prisma.$executeRawUnsafe(
      `
        DELETE FROM "state_disclosures"
        WHERE "id" = $1
      `,
      id,
    );

    if (!result) {
      return res.status(404).json({ success: false, message: 'State disclosure not found' });
    }

    return res.json({
      success: true,
      message: 'State disclosure deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting state disclosure:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete state disclosure',
      error: error.message,
    });
  }
};

