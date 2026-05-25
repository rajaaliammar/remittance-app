import { extractAmlCacheFromKycData } from './amlKycData.js';
import { resolveAmlClientNumber } from '../services/amlProvider.service.js';

function norm(value) {
  return String(value ?? '').trim();
}

/** Skip signup placeholders when building a display name. */
export function formatPortalCustomerDisplayName(customer) {
  const first = norm(customer.firstName);
  const last = norm(customer.lastName);
  const middle = norm(customer.middleName);

  const useFirst = first && first.toLowerCase() !== 'pending';
  const useLast = last && last.toLowerCase() !== 'user';

  const parts = [
    useFirst ? first : '',
    middle,
    useLast ? last : '',
  ].filter(Boolean);

  if (parts.length) return parts.join(' ');

  const email = norm(customer.email);
  if (email && !email.toLowerCase().includes('@remittance.pending')) {
    const local = email.split('@')[0]?.replace(/[._+-]/g, ' ').trim();
    if (local && local.toLowerCase() !== 'pending') return local;
  }

  const phone = norm(customer.phone ?? customer.telephone);
  if (phone) return phone;

  return '';
}

function pickProviderCustomerName(row) {
  if (!row || typeof row !== 'object') return '';
  const direct = norm(
    row.customerName ??
      row.CustomerName ??
      row.csName ??
      row.cS_NAME ??
      row.fullName ??
      row.FullName,
  );
  if (direct) return direct;

  const given = norm(row.givenName ?? row.GivenName ?? row.firstName ?? row.FirstName);
  const surname = norm(row.surname ?? row.Surname ?? row.lastName ?? row.LastName);
  const combined = [given, surname].filter(Boolean).join(' ');
  return combined;
}

function collectPinsFromCustomer(customer) {
  const pins = new Set();
  const cache = extractAmlCacheFromKycData(customer.kycData);
  const mappedPin = norm(cache?.mapped?.pin);
  if (mappedPin) pins.add(mappedPin);

  const statusRaw = cache?.lastStatusResponse;
  if (statusRaw && typeof statusRaw === 'object') {
    const statusPin = norm(statusRaw.Pin ?? statusRaw.pin);
    if (statusPin) pins.add(statusPin);
  }

  return pins;
}

/**
 * Index portal customers by AML PIN and client number for listing enrichment.
 */
export async function buildAmlCustomerLookupIndex(prisma) {
  const byPin = new Map();
  const byClientNumber = new Map();

  const customers = await prisma.customer.findMany({
    where: { kycData: { not: null } },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      middleName: true,
      kycData: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 10000,
  });

  for (const customer of customers) {
    const name = formatPortalCustomerDisplayName(customer);
    if (!name) continue;

    const entry = {
      customerName: name,
      customerId: customer.id,
      customerEmail: customer.email || null,
    };

    const clientNumber = norm(
      extractAmlCacheFromKycData(customer.kycData)?.clientNumber ||
        resolveAmlClientNumber(customer),
    );
    if (clientNumber && !byClientNumber.has(clientNumber)) {
      byClientNumber.set(clientNumber, entry);
    }

    for (const pin of collectPinsFromCustomer(customer)) {
      if (!byPin.has(pin)) byPin.set(pin, entry);
    }
  }

  return { byPin, byClientNumber };
}

export function enrichAmlListingRow(row, lookup) {
  const providerName = pickProviderCustomerName(row);
  const pin = norm(row.pin);
  const clientNumber = norm(row.clientNumber);

  const linked =
    (pin && lookup.byPin.get(pin)) ||
    (clientNumber && lookup.byClientNumber.get(clientNumber)) ||
    (pin && lookup.byClientNumber.get(pin)) ||
    null;

  const customerName = providerName || linked?.customerName || null;

  return {
    ...row,
    customerName,
    customerId: linked?.customerId ?? null,
    customerEmail: linked?.customerEmail ?? null,
  };
}

export async function enrichAmlCustomerListing(listing, prisma) {
  if (!Array.isArray(listing) || listing.length === 0) return listing;
  const lookup = await buildAmlCustomerLookupIndex(prisma);
  return listing.map((row) => enrichAmlListingRow(row, lookup));
}
