/**
 * REST Countries v3.1 `idd` shape:
 * - `root` is usually like "+1", "+44" (already includes +)
 * - `suffixes` may be [""], or NANP area codes ["201","202",...] for +1
 * Concatenating root + first suffix and then prefixing "+" again yields "++1201" — wrong.
 */

/** Collapse repeated leading + and ensure at most one leading + */
export function normalizePlusPrefix(value) {
  if (value == null || value === '') return '';
  let s = String(value).trim();
  s = s.replace(/\++/g, '+');
  if (!s.startsWith('+')) s = `+${s.replace(/^\+/, '')}`;
  return s;
}

/**
 * Country-level calling code from REST Countries `idd` (no NANP area codes).
 * US/CA/Caribbean NANP: `root` is "+1" and `suffixes` are often 3-digit area codes — return "+1" only.
 */
export function dialCodeFromRestCountriesIdd(idd) {
  const root = (idd?.root || '').trim();
  const suffixes = Array.isArray(idd?.suffixes) ? idd.suffixes : [];

  if (!root) {
    if (suffixes.length && suffixes[0]) {
      return normalizePlusPrefix(suffixes[0]);
    }
    return '';
  }

  const rootDigits = root.replace(/^\+/, '');
  const first = suffixes[0];

  if (rootDigits === '1' && suffixes.length > 0) {
    if (suffixes.length > 1 || (first && /^\d{3}$/.test(String(first)))) {
      return '+1';
    }
  }

  if (!first || first === '') {
    return normalizePlusPrefix(root);
  }

  const suffixDigits = String(first).replace(/^\+/, '');
  if (!suffixDigits) {
    return normalizePlusPrefix(root);
  }

  if (!rootDigits.endsWith(suffixDigits)) {
    return normalizePlusPrefix(`+${rootDigits}${suffixDigits}`);
  }

  return normalizePlusPrefix(root);
}

/** Map REST Countries v3.1 country object → normalized API payload */
/** Normalize user/admin-entered phone codes (fix "++1", "++44", etc.) */
export function normalizeStoredPhoneCode(input) {
  if (input == null || input === '') return '';
  return normalizePlusPrefix(String(input).trim().replace(/\s+/g, ''));
}

export function shapeCountryFromRestCountry(country, fallbackName = '') {
  const currencies = country.currencies || {};
  const currencyCode = Object.keys(currencies)[0] || '';
  const currency = currencies[currencyCode] || {};
  const phoneCode = dialCodeFromRestCountriesIdd(country.idd);

  return {
    name: country.name?.common || fallbackName,
    iso2: country.cca2 || '',
    iso3: country.cca3 || '',
    phoneCode,
    currencyName: currency.name || '',
    currencyCode,
    currencySymbol: currency.symbol || '',
    currencyNativeSymbol: currency.symbol || '',
    flag: country.flags?.png || country.flags?.svg || '',
    continent: country.continents?.[0] || '',
  };
}
