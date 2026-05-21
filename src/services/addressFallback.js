/**
 * US address autocomplete fallback when Smarty subscription is inactive (402).
 * Uses OpenStreetMap Nominatim (no API key). Results are mapped to Smarty-shaped suggestions.
 */

import https from 'https';

const NOMINATIM_HOST = 'nominatim.openstreetmap.org';
const PHOTON_HOST = 'photon.komoot.io';
/** Continental US bounding box for Photon */
const US_BBOX = '-125,24,-66,50';
const USER_AGENT = process.env.ADDRESS_FALLBACK_USER_AGENT || 'OneZaPayRemittance/1.0 (local-dev)';
const TIMEOUT_MS = 8000;

const STATE_ABBR = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC',
};

function normalizeState(state) {
  const s = String(state || '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_ABBR[s.toLowerCase()] || s;
}

function httpsGetJson(path, hostname = NOMINATIM_HOST) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname,
        path,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: body ? JSON.parse(body) : [] });
          } catch {
            resolve({ statusCode: res.statusCode, data: [] });
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Fallback address lookup timed out'));
    });
  });
}

function formatSuggestionLabel(item) {
  const street = [item.street_line, item.secondary].filter(Boolean).join(' ').trim();
  const locality = [item.city, item.state, item.zipcode].filter(Boolean).join(', ');
  return [street, locality].filter(Boolean).join(', ');
}

function mapNominatimToSuggestion(row) {
  const addr = row.address || {};
  const house = addr.house_number || '';
  const road = addr.road || addr.street || addr.pedestrian || row.name || '';
  const street_line = [house, road].filter(Boolean).join(' ').trim() || String(row.display_name || '').split(',')[0];
  const secondary = addr.unit || addr.apartment || '';
  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.municipality ||
    '';
  const state = normalizeState(addr.state || '');
  const zipcode = addr.postcode || '';
  const item = {
    street_line,
    secondary,
    city,
    state,
    zipcode,
    entries: 0,
    source: 'nominatim',
  };
  return {
    ...item,
    formatted: formatSuggestionLabel(item),
    selected: '',
    hasMultipleUnits: false,
  };
}

function mapPhotonToSuggestion(feature) {
  const p = feature.properties || {};
  if (String(p.countrycode || '').toUpperCase() !== 'US') return null;
  const house = p.housenumber || '';
  const road = p.street || p.name || '';
  const street_line = [house, road].filter(Boolean).join(' ').trim();
  if (!street_line) return null;
  const item = {
    street_line,
    secondary: '',
    city: p.city || p.county || '',
    state: normalizeState(p.state || ''),
    zipcode: p.postcode || '',
    entries: 0,
    source: 'nominatim',
  };
  return {
    ...item,
    formatted: formatSuggestionLabel(item),
    selected: '',
    hasMultipleUnits: false,
  };
}

async function photonAutocomplete(search) {
  const q = encodeURIComponent(String(search || '').trim());
  if (q.length < 3) return [];
  const path = `/api/?q=${q}&limit=8&bbox=${US_BBOX}&lang=en`;
  const { statusCode, data } = await httpsGetJson(path, PHOTON_HOST);
  if (statusCode !== 200 || !data?.features) return [];
  return data.features
    .map(mapPhotonToSuggestion)
    .filter(Boolean);
}

/** @returns {Promise<Array>} Smarty-shaped suggestions */
export async function nominatimAutocomplete(search) {
  const q = encodeURIComponent(String(search || '').trim());
  if (q.length < 3) return [];

  const path = `/search?q=${q}&format=json&addressdetails=1&countrycodes=us&limit=8`;
  const { statusCode, data } = await httpsGetJson(path, NOMINATIM_HOST);
  let results = [];
  if (statusCode === 200 && Array.isArray(data)) {
    results = data
      .filter((row) => row.address?.country_code === 'us' || row.address?.country === 'United States')
      .map(mapNominatimToSuggestion)
      .filter((s) => s.street_line && (s.city || s.state));
  }

  if (results.length === 0) {
    results = await photonAutocomplete(search);
  }

  return results;
}

/** Build validated address from a suggestion (no external validate call). */
export function validatedFromSuggestion(suggestion) {
  const street = String(suggestion.street_line || '').trim();
  const secondary = String(suggestion.secondary || '').trim();
  const city = String(suggestion.city || '').trim();
  const state = normalizeState(suggestion.state || '');
  const zipcode = String(suggestion.zipcode || '').trim();
  const delivery_line_1 = [street, secondary].filter(Boolean).join(' ').trim() || street;
  const last_line = [city, state, zipcode].filter(Boolean).join(', ');
  return {
    delivery_line_1,
    delivery_line_2: secondary || '',
    last_line,
    street: delivery_line_1,
    secondary,
    city,
    state,
    zipcode,
    plus4_code: '',
    formatted: [delivery_line_1, last_line].filter(Boolean).join(', '),
    source: suggestion.source || 'nominatim',
  };
}
