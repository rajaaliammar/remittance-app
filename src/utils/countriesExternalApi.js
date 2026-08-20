/**
 * External country metadata via countries.dev (free, no API key).
 * Replaces deprecated REST Countries v3.1, which now returns an error payload
 * instead of country data.
 *
 * Docs / migration: https://countries.dev/blog/migrate-from-restcountries
 */

const BASE_URL = 'https://countries.dev';

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return { ok: false, data: null, status: response.status };
  }

  // Guard against deprecation / error envelopes shaped like { success: false, ... }
  if (data && typeof data === 'object' && !Array.isArray(data) && data.success === false) {
    return { ok: false, data: null, status: response.status };
  }

  return { ok: true, data, status: response.status };
}

function asArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data];
  return [];
}

/** Search countries by (partial) name. Returns [] when nothing matches. */
export async function searchCountriesByName(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  const { ok, data, status } = await fetchJson(
    `${BASE_URL}/name/${encodeURIComponent(q)}`
  );

  if (!ok || status === 404) return [];
  return asArray(data);
}

/** Exact / best-effort name lookup (prefers exact common-name match). */
export async function fetchCountryByName(countryName) {
  const want = String(countryName || '').trim().toLowerCase();
  if (!want) return null;

  const countries = await searchCountriesByName(countryName);
  if (!countries.length) return null;

  const exact =
    countries.find((c) => String(c.name || '').toLowerCase() === want) ||
    countries.find((c) => String(c.nativeName || '').toLowerCase() === want);

  return exact || countries[0];
}

/** Lookup by ISO 3166-1 alpha-2 (e.g. PK, US). */
export async function fetchCountryByAlpha2(iso2) {
  const code = String(iso2 || '').trim().toUpperCase();
  if (code.length !== 2) return null;

  const { ok, data } = await fetchJson(`${BASE_URL}/alpha/${encodeURIComponent(code)}`);
  if (!ok || !data || Array.isArray(data)) {
    // Some responses may still be a one-element array
    const list = asArray(data);
    return list.find((c) => String(c.alpha2Code || '').toUpperCase() === code) || list[0] || null;
  }

  return data.alpha2Code ? data : null;
}

/** Full country list (used for phone/country pickers). */
export async function fetchAllCountries(fields) {
  const qs = fields ? `?fields=${encodeURIComponent(fields)}` : '';
  const { ok, data } = await fetchJson(`${BASE_URL}/countries${qs}`);
  if (!ok) return [];
  return asArray(data);
}

/** Unique region labels from the external API (fallback for continent suggestions). */
export async function fetchDistinctRegions() {
  const countries = await fetchAllCountries('region');
  const set = new Set();
  for (const country of countries) {
    if (country.region) set.add(country.region);
  }
  return Array.from(set).sort();
}
