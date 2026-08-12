/**
 * LiveEx TMS lookup codes for Natural Person (obj_CS_N).
 * See swagger: 01_NaturalCustomerDto
 */

/** Status / non-country tokens sometimes stored in residentCountry by the app. */
const NON_COUNTRY_TOKENS = new Set([
  'RESIDENT',
  'NON-RESIDENT',
  'NON RESIDENT',
  'NONRESIDENT',
  'N/A',
  'NA',
  'NONE',
  'UNKNOWN',
  'NULL',
  'UNDEFINED',
  'OTHER',
  'OTHERS',
]);

/** ISO2 / ISO3 / common names → ISO2 for AML Natural Person country fields. */
const COUNTRY_TO_ISO2 = {
  US: 'US',
  USA: 'US',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  AMERICA: 'US',
  CA: 'CA',
  CAN: 'CA',
  CANADA: 'CA',
  PK: 'PK',
  PAK: 'PK',
  PAKISTAN: 'PK',
  GB: 'GB',
  UK: 'GB',
  'UNITED KINGDOM': 'GB',
  'GREAT BRITAIN': 'GB',
  ET: 'ET',
  ETH: 'ET',
  ETHIOPIA: 'ET',
  MX: 'MX',
  MEX: 'MX',
  MEXICO: 'MX',
  CV: 'CV',
  CPV: 'CV',
  'CAPE VERDE': 'CV',
  'CABO VERDE': 'CV',
  SO: 'SO',
  SOM: 'SO',
  SOMALIA: 'SO',
  KE: 'KE',
  KEN: 'KE',
  KENYA: 'KE',
  NG: 'NG',
  NGA: 'NG',
  NIGERIA: 'NG',
  IN: 'IN',
  IND: 'IN',
  INDIA: 'IN',
  AE: 'AE',
  ARE: 'AE',
  'UNITED ARAB EMIRATES': 'AE',
  UAE: 'AE',
};

/** Dial codes for formatAmlPhone (ISO2 → country calling code). */
const ISO_DIAL_CODE = {
  US: '1',
  CA: '1',
  PK: '92',
  GB: '44',
  ET: '251',
  MX: '52',
  CV: '238',
  SO: '252',
  KE: '254',
  NG: '234',
  IN: '91',
  AE: '971',
};

/** US state / CA province codes — never treat these as country ISO2 (except CA/IN handled as countries). */
const SUBDIVISION_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

/** Map ISO country to AML csClientLocation (1=VCE region, 2=Canada outside VCE, 3=outside Canada) */
export function resolveClientLocation(countryCode) {
  const c = String(countryCode || 'US').toUpperCase();
  if (c === 'CA') return 2;
  return 3;
}

/**
 * ID document type — csNIdentifier.
 * Prefer explicit id_type / document labels from KYC over residential country heuristics.
 */
export function resolveIdentifierType(kyc, countryCode, issueCountry) {
  const hint = `${kyc?.id_type || ''} ${kyc?.idType || ''} ${kyc?.document_type || ''} ${kyc?.docTypeName || ''}`.toLowerCase();
  const issue = String(issueCountry || countryCode || 'US').toUpperCase();

  if (kyc?.ssn || kyc?.government_id || /\bssn\b/.test(hint)) return 15;
  if (kyc?.cnic || /\bcnic\b/.test(hint)) return 4;
  if (/passport/.test(hint) || kyc?.passportNumber || kyc?.passport) return 5;

  if (/driver|licence|license|lisence/.test(hint)) {
    // LiveEx portal labels Canadian DL distinctly; 7 aligns with Digital Onboarding Drivers Licence.
    return 7;
  }

  if (/citizen|national.?id|state.?id|identity/.test(hint)) return 4;

  const c = String(countryCode || 'US').toUpperCase();
  if (issue === 'CA') return 7;
  return c === 'US' ? 15 : 5;
}

/**
 * Normalize free-text / ISO / alpha-3 country values to ISO2 for AML.
 * Never invent a code by slicing multi-word names (e.g. "Cape Verde" → "CA").
 */
export function normalizeCountryCode(value, fallback = 'US') {
  if (value == null || String(value).trim() === '') {
    return String(fallback || 'US').toUpperCase();
  }

  const raw = String(value).trim();
  const v = raw.toUpperCase().replace(/\s+/g, ' ');

  if (NON_COUNTRY_TOKENS.has(v) || NON_COUNTRY_TOKENS.has(v.replace(/-/g, ' '))) {
    return String(fallback || 'US').toUpperCase();
  }

  // LiveEx Digital Onboarding numeric country ids (when leaked into AML fields)
  if (/^\d+$/.test(v)) {
    const fromLiveex = LIVEEX_COUNTRY_ID_TO_ISO2[v];
    if (fromLiveex) return fromLiveex;
    return String(fallback || 'US').toUpperCase();
  }

  if (COUNTRY_TO_ISO2[v]) return COUNTRY_TO_ISO2[v];

  // Exact ISO2 — allow known countries; reject bare subdivision codes except CA (Canada)
  if (/^[A-Z]{2}$/.test(v)) {
    if (COUNTRY_TO_ISO2[v]) return COUNTRY_TO_ISO2[v];
    if (SUBDIVISION_CODES.has(v)) {
      return String(fallback || 'US').toUpperCase();
    }
    return v;
  }

  // ISO3
  if (/^[A-Z]{3}$/.test(v) && COUNTRY_TO_ISO2[v]) return COUNTRY_TO_ISO2[v];

  // Fuzzy contains for longer names
  for (const [name, iso] of Object.entries(COUNTRY_TO_ISO2)) {
    if (name.length > 3 && v.includes(name)) return iso;
  }

  return String(fallback || 'US').toUpperCase();
}

/**
 * LiveEx Digital Onboarding /api/lookups/countries ids → ISO2.
 * Critical: 308 is Cape Verde, NOT United States (251).
 */
export const LIVEEX_COUNTRY_ID_TO_ISO2 = {
  251: 'US',
  307: 'CA',
  308: 'CV', // Cape Verde — do not treat as US
  539: 'CV', // Cabo Verde
  253: 'PK',
  346: 'ET',
  364: 'HN', // Honduras (historically misused as Pakistan in our code)
  252: 'GB',
  503: 'MX',
};

/** ISO2 → LiveEx Digital Onboarding country lookup id */
export const ISO2_TO_LIVEEX_COUNTRY_ID = {
  US: '251',
  CA: '307',
  CV: '308',
  PK: '253',
  ET: '346',
  GB: '252',
  MX: '503',
  HN: '364',
};

/** Resolve jurisdiction-of-issue country from ID document, not citizenship. */
export function resolveJurisdictionIssueCountry({
  idType,
  docTypeName,
  residentialCountry,
  citizenship,
  explicitIssueCountry,
} = {}) {
  if (explicitIssueCountry) {
    return normalizeCountryCode(explicitIssueCountry, residentialCountry || 'US');
  }

  const hint = `${idType || ''} ${docTypeName || ''}`.toLowerCase();
  if (/canada|canadian|\bca\b/.test(hint) && /driver|licence|license|lisence/.test(hint)) {
    return 'CA';
  }
  if (
    (/united states|\busa\b|\bus\b/.test(hint) || /state.?id|real.?id/.test(hint)) &&
    /driver|licence|license|lisence|state/.test(hint)
  ) {
    return 'US';
  }
  if (/driver|licence|license|lisence/.test(hint)) {
    // App is US-address first; default DL issue country to residential when unlabeled
    return normalizeCountryCode(residentialCountry || citizenship || 'US');
  }
  if (/passport/.test(hint)) {
    return normalizeCountryCode(citizenship || residentialCountry || 'US');
  }
  if (/citizen|national.?id|state.?id|identity/.test(hint)) {
    return normalizeCountryCode(citizenship || residentialCountry || 'US');
  }

  return normalizeCountryCode(citizenship || residentialCountry || 'US');
}

/**
 * Jurisdiction state/province — only send when compatible with issue country.
 * Sending US state "MN" under Cape Verde / Canada clears the country in TMS.
 */
export function resolveJurisdictionIssueState(issueCountry, region) {
  const country = String(issueCountry || '').toUpperCase();
  const state = String(region || '').trim().toUpperCase();
  if (!state || state === 'NA' || state === 'N/A') return '';

  const usStates = new Set([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL',
    'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT',
    'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
    'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
  ]);
  const caProvinces = new Set([
    'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
  ]);

  if (country === 'US') {
    return usStates.has(state) ? state : '';
  }
  if (country === 'CA') {
    return caProvinces.has(state) ? state : '';
  }
  // Unknown country lists — pass through non-empty region
  return state;
}

/** csSourceOfFund — default Salary */
export function resolveSourceOfFund(sourceText) {
  const s = String(sourceText || '').toLowerCase();
  if (s.includes('saving')) return 2;
  if (s.includes('business') || s.includes('freelance')) return 4;
  return 1; // Salary
}

/** csOccupation — provider occupation code (integer) */
export function resolveOccupationCode(occupationText) {
  const s = String(occupationText || '').toLowerCase();
  if (s.includes('engineer')) return 50;
  if (s.includes('teacher')) return 200;
  if (s.includes('student')) return 180;
  if (s.includes('retired')) return 150;
  return 1;
}

/** csProfession ID string: 875=Salaried, 876=Unemployed, 877=Self Employed */
export function resolveProfessionId(occupationText, sourceText) {
  const s = `${occupationText || ''} ${sourceText || ''}`.toLowerCase();
  if (s.includes('self') || s.includes('freelance') || s.includes('business')) return '877';
  if (s.includes('unemploy')) return '876';
  // Salary / employment income / salaried → Salaried even when occupation is "Others"
  if (s.includes('salar') || s.includes('employ') || s.includes('wage') || s.includes('job')) {
    return '875';
  }
  return '875';
}

/**
 * Split stored phone (`${dial}${national}`) into LiveEx save-website fields:
 * mobileNumberCode + phone (national only — do not put dial code in phone).
 */
export function splitPhoneForLiveex(phone, countryCode = 'US') {
  const iso = normalizeCountryCode(countryCode, 'US');
  const dial = ISO_DIAL_CODE[iso] || '1';
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) {
    return { mobileNumberCode: dial, nationalNumber: '0000000000' };
  }
  if (digits.startsWith(dial) && digits.length > dial.length + 6) {
    digits = digits.slice(dial.length);
  }
  if (dial === '1') {
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    if (digits.length >= 10) digits = digits.slice(-10);
  }
  return { mobileNumberCode: dial, nationalNumber: digits || '0000000000' };
}

/**
 * AML phone: CountryCode-Number e.g. 1-6124326758
 * Strips a leading dial code already embedded in stored phone (signup saves `${cc}${national}`).
 */
export function formatAmlPhone(phone, countryCode = 'US') {
  const { mobileNumberCode, nationalNumber } = splitPhoneForLiveex(phone, countryCode);
  return `${mobileNumberCode}-${nationalNumber}`;
}

export const AML_DEFAULTS = {
  businessPurpose: parseInt(process.env.AML_DEFAULT_BUSINESS_PURPOSE || '10', 10), // Cross-border
  industryType: parseInt(process.env.AML_DEFAULT_INDUSTRY_TYPE || '1030', 10),
  typesOfServices: process.env.AML_DEFAULT_TYPES_OF_SERVICES || '1', // Foreign Exchange
  deliveryChannel: parseInt(process.env.AML_DEFAULT_DELIVERY_CHANNEL || '2', 10), // Non face-to-face
  clientStatus: parseInt(process.env.AML_DEFAULT_CLIENT_STATUS || '10', 10), // Non-Resident
};
