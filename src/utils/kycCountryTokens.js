import prisma from './prisma.js';

/**
 * Tokens that match KYC form `countries` (portal stores currency codes like USD
 * from Manage Country; the app may send ISO2).
 */
export async function expandKycCountryTokens(countryCode) {
  const c = String(countryCode || '').trim().toUpperCase();
  const set = new Set(c ? [c] : []);

  const mergeFamily = (family) => {
    if (family.some((x) => set.has(x))) family.forEach((x) => set.add(x));
  };

  mergeFamily(['USD', 'US', 'USA']);
  mergeFamily(['CAD', 'CA', 'CAN']);
  mergeFamily(['INR', 'IN', 'IND']);
  mergeFamily(['ETB', 'ET', 'ETH']);
  mergeFamily(['GBP', 'GB', 'GBR']);
  mergeFamily(['PKR', 'PK', 'PAK']);

  if (c.length === 2 && /^[A-Z]{2}$/.test(c)) {
    try {
      const row = await prisma.country.findUnique({
        where: { iso2: c },
        select: { currencyCode: true },
      });
      const cur = row?.currencyCode && String(row.currencyCode).trim().toUpperCase();
      if (cur) set.add(cur);
    } catch (e) {
      console.warn('[KYC] expandKycCountryTokens country lookup failed:', e?.message);
    }
  }

  return set;
}

export function kycFormMatchesCountryTokens(form, requestedTokens) {
  const countries = Array.isArray(form.countries) ? form.countries : [];
  const normalizedList = countries
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean);
  if (normalizedList.length === 0) return true;
  return normalizedList.some((cc) => requestedTokens.has(cc));
}
