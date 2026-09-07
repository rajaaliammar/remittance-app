#!/usr/bin/env node
/**
 * Seed all 51 MSB state regulator disclosures from
 * data/msb-state-disclosures.json (exported from Excel).
 *
 * Usage: node scripts/seed-msb-state-disclosures.js
 */
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../src/utils/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureTable() {
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
}

async function main() {
  const seedPath = path.resolve(__dirname, '../data/msb-state-disclosures.json');
  const rows = JSON.parse(await readFile(seedPath, 'utf8'));
  await ensureTable();

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const stateInitial = String(row.stateInitial || '').trim().toUpperCase();
    const stateName = String(row.stateName || '').trim();
    const institution = String(row.institution || '').trim();
    const phone = String(row.phone || '').trim();
    const website = String(row.website || '').trim();
    const email = String(row.email || '').trim();
    const address = String(row.address || '').trim();
    const disclosureText = String(row.disclosureText || '').trim();
    if (!stateInitial || !stateName || !disclosureText) continue;

    const existing = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "state_disclosures" WHERE UPPER(TRIM("stateInitial")) = $1 LIMIT 1`,
      stateInitial,
    );
    if (existing?.[0]?.id) {
      await prisma.$executeRawUnsafe(
        `UPDATE "state_disclosures"
         SET "stateName"=$1, "institution"=$2, "phone"=$3, "website"=$4,
             "email"=$5, "address"=$6, "disclosureText"=$7, "updatedAt"=NOW()
         WHERE "id"=$8`,
        stateName, institution, phone, website, email, address, disclosureText, existing[0].id,
      );
      updated += 1;
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "state_disclosures"
          ("id","stateInitial","stateName","institution","phone","website","email","address","disclosureText","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
        randomUUID(), stateInitial, stateName, institution, phone, website, email, address, disclosureText,
      );
      created += 1;
    }
  }

  console.log(`MSB seed done: ${created} created, ${updated} updated (${rows.length} source rows)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
