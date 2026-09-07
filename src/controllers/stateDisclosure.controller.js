import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../utils/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const US_STATES_FALLBACK = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

const NAME_TO_CODE = Object.fromEntries(
  US_STATES_FALLBACK.map((s) => [s.name.toUpperCase(), s.code]),
);

const normalizeRegionToInitial = (raw) => {
  const input = String(raw || '')
    .toUpperCase()
    .replace(/\./g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!input) return null;
  if (/^[A-Z]{2}$/.test(input) && US_STATES_FALLBACK.some((s) => s.code === input)) {
    return input;
  }
  if (NAME_TO_CODE[input]) return NAME_TO_CODE[input];
  for (const token of input.split(' ')) {
    if (/^[A-Z]{2}$/.test(token) && US_STATES_FALLBACK.some((s) => s.code === token)) {
      return token;
    }
  }
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (input.includes(name)) return code;
  }
  return null;
};

const findDisclosureByInitial = async (stateInitial) => {
  if (!stateInitial) return null;
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT
        "id", "stateInitial", "stateName", "institution", "phone",
        "website", "email", "address", "disclosureText", "createdAt", "updatedAt"
      FROM "state_disclosures"
      WHERE UPPER(TRIM("stateInitial")) = UPPER(TRIM($1))
      LIMIT 1
    `,
    stateInitial,
  );
  return rows?.[0] || null;
};

const resolveCustomerStateDisclosure = async (customerId) => {
  const customer = await prisma.customer.findUnique({
    where: { id: String(customerId) },
    select: {
      id: true,
      region: true,
      city: true,
      zipCode: true,
      country: true,
      firstName: true,
      lastName: true,
    },
  });
  if (!customer) return { error: 'Customer not found', status: 404 };

  const verifiedStateInitial = normalizeRegionToInitial(customer.region);
  const disclosure = verifiedStateInitial
    ? await findDisclosureByInitial(verifiedStateInitial)
    : null;

  return {
    data: {
      customerId: customer.id,
      region: customer.region || null,
      verifiedStateInitial,
      verifiedStateName:
        disclosure?.stateName ||
        US_STATES_FALLBACK.find((s) => s.code === verifiedStateInitial)?.name ||
        null,
      matched: Boolean(disclosure),
      disclosure,
    },
  };
};

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

/** Free US states list (CountriesNow API) with local fallback — for portal dropdown. */
export const listUsStates = async (_req, res) => {
  try {
    let states = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const response = await fetch('https://countriesnow.space/api/v0.1/countries/states', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ country: 'United States' }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.ok) {
        const json = await response.json();
        const rawStates = json?.data?.states;
        if (Array.isArray(rawStates) && rawStates.length) {
          states = rawStates
            .map((row) => {
              const name = String(row?.name || '').trim();
              const code =
                normalizeRegionToInitial(row?.state_code || row?.iso2 || name) ||
                NAME_TO_CODE[name.toUpperCase()] ||
                null;
              if (!name || !code) return null;
              return { code, name };
            })
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name));
        }
      }
    } catch (apiError) {
      console.warn('[state-disclosures] US states free API unavailable:', apiError.message);
    }

    if (!states?.length) {
      states = [...US_STATES_FALLBACK];
    } else {
      // CountriesNow often omits DC — merge local fallback so portal always has 51.
      const byCode = new Map(states.map((s) => [s.code, s]));
      for (const row of US_STATES_FALLBACK) {
        if (!byCode.has(row.code)) byCode.set(row.code, row);
      }
      states = [...byCode.values()];
    }

    states.sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      success: true,
      source: 'countriesnow+fallback',
      data: states,
    });
  } catch (error) {
    console.error('Error listing US states:', error);
    return res.json({
      success: true,
      source: 'fallback',
      data: [...US_STATES_FALLBACK].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
};

/** Resolve disclosure by verifying customer region from user id. */
export const getDisclosureForCustomer = async (req, res) => {
  try {
    await ensureStateDisclosuresTable();
    const customerId = req.params.customerId || req.params.id;
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer id is required' });
    }
    const result = await resolveCustomerStateDisclosure(customerId);
    if (result.error) {
      return res.status(result.status || 404).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Error resolving customer state disclosure:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resolve state disclosure for customer',
      error: error.message,
    });
  }
};

/** Authenticated customer: verify own profile region → state disclosure. */
export const getDisclosureForMe = async (req, res) => {
  try {
    await ensureStateDisclosuresTable();
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Customer authentication required' });
    }
    const result = await resolveCustomerStateDisclosure(customerId);
    if (result.error) {
      return res.status(result.status || 404).json({ success: false, message: result.error });
    }
    return res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Error resolving my state disclosure:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resolve state disclosure',
      error: error.message,
    });
  }
};

/** Upsert all 51 MSB regulator disclosures from bundled Excel export JSON. */
export const seedMsbStateDisclosures = async (_req, res) => {
  try {
    await ensureStateDisclosuresTable();
    const seedPath = path.resolve(__dirname, '../../data/msb-state-disclosures.json');
    const raw = await readFile(seedPath, 'utf8');
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ success: false, message: 'Seed file is empty' });
    }

    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const payload = toDisclosurePayload(row);
      const validationError = validatePayload(payload);
      if (validationError) continue;

      const existing = await findDisclosureByInitial(payload.stateInitial);
      if (existing?.id) {
        await prisma.$executeRawUnsafe(
          `
            UPDATE "state_disclosures"
            SET
              "stateName" = $1,
              "institution" = $2,
              "phone" = $3,
              "website" = $4,
              "email" = $5,
              "address" = $6,
              "disclosureText" = $7,
              "updatedAt" = NOW()
            WHERE "id" = $8
          `,
          payload.stateName,
          payload.institution,
          payload.phone,
          payload.website,
          payload.email,
          payload.address,
          payload.disclosureText,
          existing.id,
        );
        updated += 1;
      } else {
        await prisma.$executeRawUnsafe(
          `
            INSERT INTO "state_disclosures" (
              "id", "stateInitial", "stateName", "institution", "phone",
              "website", "email", "address", "disclosureText", "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
            )
          `,
          randomUUID(),
          payload.stateInitial,
          payload.stateName,
          payload.institution,
          payload.phone,
          payload.website,
          payload.email,
          payload.address,
          payload.disclosureText,
        );
        created += 1;
      }
    }

    return res.json({
      success: true,
      message: `MSB state disclosures seeded (${created} created, ${updated} updated)`,
      data: { created, updated, total: rows.length },
    });
  } catch (error) {
    console.error('Error seeding MSB state disclosures:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to seed MSB state disclosures',
      error: error.message,
    });
  }
};

