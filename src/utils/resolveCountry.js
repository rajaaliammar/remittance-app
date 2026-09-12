/**
 * Resolve a country from route/query params.
 * Accepts DB id, ISO2/ISO3, or mobile fallback ids like "fallback-us".
 */

const FALLBACK_META = {
  US: { name: 'United States', iso3: 'USA', phoneCode: '+1', currencyName: 'US Dollar', currencyCode: 'USD', currencyRate: '1' },
  CA: { name: 'Canada', iso3: 'CAN', phoneCode: '+1', currencyName: 'Canadian Dollar', currencyCode: 'CAD', currencyRate: '1.36' },
  GB: { name: 'United Kingdom', iso3: 'GBR', phoneCode: '+44', currencyName: 'Pound Sterling', currencyCode: 'GBP', currencyRate: '0.79' },
  ET: { name: 'Ethiopia', iso3: 'ETH', phoneCode: '+251', currencyName: 'Ethiopian Birr', currencyCode: 'ETB', currencyRate: '57' },
  IN: { name: 'India', iso3: 'IND', phoneCode: '+91', currencyName: 'Indian Rupee', currencyCode: 'INR', currencyRate: '83' },
  MX: { name: 'Mexico', iso3: 'MEX', phoneCode: '+52', currencyName: 'Mexican Peso', currencyCode: 'MXN', currencyRate: '17' },
  PH: { name: 'Philippines', iso3: 'PHL', phoneCode: '+63', currencyName: 'Philippine Peso', currencyCode: 'PHP', currencyRate: '56' },
  NG: { name: 'Nigeria', iso3: 'NGA', phoneCode: '+234', currencyName: 'Nigerian Naira', currencyCode: 'NGN', currencyRate: '1550' },
};

/** Demo banks when remittance_banks has no Active assignment for the country. */
export const DEFAULT_BANKS_BY_ISO2 = {
  US: [
    { id: 'demo-us-chase', name: 'Chase', website: 'https://www.chase.com', dollarRate: '1' },
    { id: 'demo-us-bofa', name: 'Bank of America', website: 'https://www.bankofamerica.com', dollarRate: '1' },
    { id: 'demo-us-wells', name: 'Wells Fargo', website: 'https://www.wellsfargo.com', dollarRate: '1' },
    { id: 'demo-us-citi', name: 'Citibank', website: 'https://www.citi.com', dollarRate: '1' },
  ],
  CA: [
    { id: 'demo-ca-rbc', name: 'RBC Royal Bank', website: 'https://www.rbcroyalbank.com', dollarRate: '1.36' },
    { id: 'demo-ca-td', name: 'TD Canada Trust', website: 'https://www.td.com', dollarRate: '1.36' },
    { id: 'demo-ca-scotiabank', name: 'Scotiabank', website: 'https://www.scotiabank.com', dollarRate: '1.36' },
  ],
  GB: [
    { id: 'demo-gb-barclays', name: 'Barclays', website: 'https://www.barclays.co.uk', dollarRate: '0.79' },
    { id: 'demo-gb-hsbc', name: 'HSBC UK', website: 'https://www.hsbc.co.uk', dollarRate: '0.79' },
    { id: 'demo-gb-lloyds', name: 'Lloyds Bank', website: 'https://www.lloydsbank.com', dollarRate: '0.79' },
    { id: 'demo-gb-monzo', name: 'Monzo', website: 'https://monzo.com', dollarRate: '0.79' },
  ],
  ET: [
    { id: 'demo-et-cbe', name: 'Commercial Bank of Ethiopia', website: 'https://www.combanketh.et', dollarRate: '57' },
    { id: 'demo-et-awash', name: 'Awash Bank', website: 'https://www.awashbank.com', dollarRate: '57' },
    { id: 'demo-et-dashen', name: 'Dashen Bank', website: 'https://dashenbanksc.com', dollarRate: '57' },
  ],
  IN: [
    { id: 'demo-in-hdfc', name: 'HDFC Bank', website: 'https://www.hdfcbank.com', dollarRate: '83' },
    { id: 'demo-in-sbi', name: 'State Bank of India', website: 'https://www.sbi.co.in', dollarRate: '83' },
    { id: 'demo-in-icici', name: 'ICICI Bank', website: 'https://www.icicibank.com', dollarRate: '83' },
  ],
  MX: [
    { id: 'demo-mx-bbva', name: 'BBVA México', website: 'https://www.bbva.mx', dollarRate: '17' },
    { id: 'demo-mx-banorte', name: 'Banorte', website: 'https://www.banorte.com', dollarRate: '17' },
  ],
  PH: [
    { id: 'demo-ph-bdo', name: 'BDO Unibank', website: 'https://www.bdo.com.ph', dollarRate: '56' },
    { id: 'demo-ph-bpi', name: 'Bank of the Philippine Islands', website: 'https://www.bpi.com.ph', dollarRate: '56' },
  ],
  NG: [
    { id: 'demo-ng-gtb', name: 'Guaranty Trust Bank', website: 'https://www.gtbank.com', dollarRate: '1550' },
    { id: 'demo-ng-zenith', name: 'Zenith Bank', website: 'https://www.zenithbank.com', dollarRate: '1550' },
  ],
};

/**
 * Normalize a country route param into a candidate ISO2 (when possible).
 * @param {string} raw
 * @returns {string}
 */
export function extractIso2Candidate(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const fallback = value.match(/^fallback[-_]?([a-z]{2})$/i);
  if (fallback) return fallback[1].toUpperCase();
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase();
  return '';
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} countryParam
 * @param {{ iso2?: string }} [opts]
 */
export async function resolveCountry(prisma, countryParam, opts = {}) {
  const param = String(countryParam || '').trim();
  const queryIso2 = String(opts.iso2 || '').trim().toUpperCase();
  const isoFromParam = extractIso2Candidate(param);
  const iso2 = queryIso2 || isoFromParam;

  const select = {
    id: true,
    iso2: true,
    iso3: true,
    name: true,
    currencyCode: true,
    currencyRate: true,
    phoneCode: true,
  };

  if (param) {
    const byId = await prisma.country.findUnique({ where: { id: param }, select });
    if (byId) return { country: byId, virtual: false };
  }

  if (iso2) {
    const byIso2 = await prisma.country.findFirst({
      where: { iso2: { equals: iso2, mode: 'insensitive' } },
      select,
    });
    if (byIso2) return { country: byIso2, virtual: false };
  }

  if (param.length === 3) {
    const byIso3 = await prisma.country.findFirst({
      where: { iso3: { equals: param, mode: 'insensitive' } },
      select,
    });
    if (byIso3) return { country: byIso3, virtual: false };
  }

  if (iso2 && FALLBACK_META[iso2]) {
    const meta = FALLBACK_META[iso2];
    return {
      country: {
        id: param || `fallback-${iso2.toLowerCase()}`,
        iso2,
        iso3: meta.iso3,
        name: meta.name,
        currencyCode: meta.currencyCode,
        currencyRate: meta.currencyRate,
        phoneCode: meta.phoneCode,
      },
      virtual: true,
    };
  }

  return { country: null, virtual: false };
}

export function defaultBanksForIso2(iso2, currencyRate) {
  const code = String(iso2 || '').toUpperCase();
  const rows = DEFAULT_BANKS_BY_ISO2[code] || [];
  const rate =
    currencyRate != null && String(currencyRate).trim() !== ''
      ? String(currencyRate)
      : null;
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    logo: null,
    website: b.website,
    email: null,
    phoneNumber: null,
    address: null,
    active: true,
    dollarRate: rate || b.dollarRate || null,
    assignedCountries: [
      {
        countryCode: code,
        country: FALLBACK_META[code]?.name || code,
        dollarPrice: rate || b.dollarRate || null,
        status: 'Active',
      },
    ],
    isDemo: true,
  }));
}
