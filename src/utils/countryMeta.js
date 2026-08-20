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

/** Normalize user/admin-entered phone codes (fix "++1", "++44", etc.) */
export function normalizeStoredPhoneCode(input) {
  if (input == null || input === '') return '';
  return normalizePlusPrefix(String(input).trim().replace(/\s+/g, ''));
}

/** Dial code from countries.dev `callingCodes` (e.g. ["92"] → "+92"). */
export function dialCodeFromCallingCodes(callingCodes) {
  const first = Array.isArray(callingCodes) ? callingCodes[0] : '';
  if (first == null || first === '') return '';
  return normalizePlusPrefix(String(first));
}

/**
 * Map countries.dev region/subregion → admin continent labels used in this app
 * (Asia, Europe, Africa, North America, South America, Oceania, Antarctica, Australia).
 */
export function continentLabelFromCountriesDev(country) {
  const region = String(country?.region || '').trim();
  const subregion = String(country?.subregion || '').trim();

  if (region === 'Americas') {
    return subregion === 'South America' ? 'South America' : 'North America';
  }
  if (region === 'Oceania') return 'Oceania';
  if (region === 'Antarctic' || region === 'Antarctic Ocean' || region === 'Polar') {
    return 'Antarctica';
  }
  return region;
}

/** Whether a countries.dev record belongs to the selected admin continent. */
export function countryMatchesContinent(country, continentName) {
  if (!continentName) return true;

  const want = String(continentName).trim().toLowerCase();
  if (!want) return true;

  const label = continentLabelFromCountriesDev(country).toLowerCase();
  if (label === want) return true;

  // Admin DB may use "Australia" while the API uses region "Oceania"
  if (want === 'australia' && String(country?.region || '').toLowerCase() === 'oceania') {
    return true;
  }

  return false;
}

/** Map countries.dev country object → normalized API payload */
export function shapeCountryFromCountriesDev(country, fallbackName = '') {
  const currencies = Array.isArray(country?.currencies) ? country.currencies : [];
  const currency = currencies[0] || {};
  const phoneCode = dialCodeFromCallingCodes(country?.callingCodes);

  return {
    name: country?.name || fallbackName,
    iso2: country?.alpha2Code || '',
    iso3: country?.alpha3Code || '',
    phoneCode,
    currencyName: currency.name || '',
    currencyCode: currency.code || '',
    currencySymbol: currency.symbol || '',
    currencyNativeSymbol: currency.symbol || '',
    flag: country?.flags?.png || country?.flags?.svg || '',
    continent: continentLabelFromCountriesDev(country),
  };
}

/** @deprecated REST Countries v3.1 is deprecated; kept for any legacy callers */
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
