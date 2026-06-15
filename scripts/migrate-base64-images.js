/**
 * One-time migration: externalize base64 images already stored in PostgreSQL.
 *   node scripts/migrate-base64-images.js
 *   node scripts/migrate-base64-images.js --dry-run
 */
import '../src/env-bootstrap.js';
import prisma from '../src/utils/prisma.js';
import {
  sanitizeImageFieldsDeep,
  sanitizeLogoField,
  isBase64ImageValue,
} from '../src/utils/imageFieldSanitizer.js';

const dryRun = process.argv.includes('--dry-run');

async function migrateManageContent() {
  const rows = await prisma.manageContent.findMany();
  let changed = 0;
  for (const row of rows) {
    const englishData = row.englishData
      ? await sanitizeImageFieldsDeep(row.englishData, { category: 'cms', path: 'englishData' })
      : row.englishData;
    const spanishData = row.spanishData
      ? await sanitizeImageFieldsDeep(row.spanishData, { category: 'cms', path: 'spanishData' })
      : row.spanishData;
    const images = row.images
      ? await sanitizeImageFieldsDeep(row.images, { category: 'cms', path: 'images' })
      : row.images;

    if (
      JSON.stringify(englishData) !== JSON.stringify(row.englishData) ||
      JSON.stringify(spanishData) !== JSON.stringify(row.spanishData) ||
      JSON.stringify(images) !== JSON.stringify(row.images)
    ) {
      console.log(`[migrate] manage_content ${row.sectionType}`);
      changed++;
      if (!dryRun) {
        await prisma.manageContent.update({
          where: { id: row.id },
          data: { englishData, spanishData, images },
        });
      }
    }
  }
  return changed;
}

async function migrateLogoColumn(model, tableLabel, category) {
  const rows = await prisma[model].findMany({
    where: { logo: { not: null } },
    select: { id: true, logo: true },
  });
  let changed = 0;
  for (const row of rows) {
    if (!isBase64ImageValue(row.logo)) continue;
    const logo = await sanitizeLogoField(row.logo, category);
    if (logo === row.logo) continue;
    console.log(`[migrate] ${tableLabel} ${row.id}`);
    changed++;
    if (!dryRun) {
      await prisma[model].update({ where: { id: row.id }, data: { logo } });
    }
  }
  return changed;
}

async function migrateCountryFlags() {
  const rows = await prisma.country.findMany({
    where: { flag: { not: null } },
    select: { id: true, flag: true, name: true },
  });
  let changed = 0;
  for (const row of rows) {
    if (!isBase64ImageValue(row.flag)) continue;
    const flag = await sanitizeLogoField(row.flag, 'countries');
    if (flag === row.flag) continue;
    console.log(`[migrate] country ${row.name}`);
    changed++;
    if (!dryRun) {
      await prisma.country.update({ where: { id: row.id }, data: { flag } });
    }
  }
  return changed;
}

async function migrateMenus() {
  const rows = await prisma.menu.findMany();
  let changed = 0;
  for (const row of rows) {
    const logo = row.logo ? await sanitizeLogoField(row.logo, 'menus') : row.logo;
    const items = row.items
      ? await sanitizeImageFieldsDeep(row.items, { category: 'menus', path: 'items' })
      : row.items;
    const footerPages = row.footerPages
      ? await sanitizeImageFieldsDeep(row.footerPages, { category: 'menus', path: 'footerPages' })
      : row.footerPages;
    const footerUsefulLinks = row.footerUsefulLinks
      ? await sanitizeImageFieldsDeep(row.footerUsefulLinks, {
          category: 'menus',
          path: 'footerUsefulLinks',
        })
      : row.footerUsefulLinks;
    const footerSupportLinks = row.footerSupportLinks
      ? await sanitizeImageFieldsDeep(row.footerSupportLinks, {
          category: 'menus',
          path: 'footerSupportLinks',
        })
      : row.footerSupportLinks;

    if (
      logo !== row.logo ||
      JSON.stringify(items) !== JSON.stringify(row.items) ||
      JSON.stringify(footerPages) !== JSON.stringify(row.footerPages) ||
      JSON.stringify(footerUsefulLinks) !== JSON.stringify(row.footerUsefulLinks) ||
      JSON.stringify(footerSupportLinks) !== JSON.stringify(row.footerSupportLinks)
    ) {
      console.log(`[migrate] menu ${row.menuType}`);
      changed++;
      if (!dryRun) {
        await prisma.menu.update({
          where: { id: row.id },
          data: { logo, items, footerPages, footerUsefulLinks, footerSupportLinks },
        });
      }
    }
  }
  return changed;
}

async function main() {
  console.log(dryRun ? '[migrate] DRY RUN' : '[migrate] Writing changes…');
  let total = 0;
  total += await migrateManageContent();
  total += await migrateLogoColumn('paymentGateway', 'payment_gateway', 'gateways');
  total += await migrateLogoColumn('manualGateway', 'manual_gateway', 'gateways');
  total += await migrateLogoColumn('remittanceBank', 'remittance_bank', 'banks');
  total += await migrateLogoColumn('remittanceWallet', 'remittance_wallet', 'wallets');
  total += await migrateCountryFlags();
  total += await migrateMenus();
  console.log(`[migrate] Done — ${total} record(s) ${dryRun ? 'would change' : 'updated'}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
