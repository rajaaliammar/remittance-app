import https from 'https';
import {
  nominatimAutocomplete,
  validatedFromSuggestion,
} from '../services/addressFallback.js';

const SMARTY_AUTOCOMPLETE_HOST = 'us-autocomplete-pro.api.smarty.com';
const SMARTY_STREET_HOST = 'us-street.api.smarty.com';
const VALIDATE_TIMEOUT_MS = 5000;
const AUTOCOMPLETE_TIMEOUT_MS = 8000;
const MIN_SEARCH_LENGTH = 3;
const MAX_SEARCH_LENGTH = 200;

function fallbackEnabled() {
  const flag = (process.env.ADDRESS_FALLBACK_ENABLED ?? 'true').trim().toLowerCase();
  return flag !== 'false' && flag !== '0';
}

async function autocompleteViaFallback(search) {
  const suggestions = await nominatimAutocomplete(search);
  console.log('[AddressController] Nominatim fallback suggestions:', suggestions.length);
  return suggestions;
}

function sanitizeSearch(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_LENGTH);
}

/** Human-readable line for mobile dropdowns. */
function formatSuggestionLabel(item) {
  if (!item || typeof item !== 'object') return '';
  const street = [item.street_line, item.secondary].filter(Boolean).join(' ').trim();
  const locality = [item.city, item.state, item.zipcode].filter(Boolean).join(', ');
  return [street, locality].filter(Boolean).join(', ');
}

/** Smarty `selected` token when a suggestion has multiple units (entries > 1). */
function buildSelectedToken(item) {
  if (!item) return '';
  const street = String(item.street_line || '').trim();
  const secondary = String(item.secondary || '').trim();
  const city = String(item.city || '').trim();
  const state = String(item.state || '').trim();
  const zip = String(item.zipcode || '').trim();
  const entries = item.entries != null ? Number(item.entries) : 0;
  if (!street || !city || !state) return '';
  const entriesPart = entries > 1 ? ` (${entries})` : '';
  return `${street}${secondary ? ` ${secondary}` : ''}${entriesPart} ${city} ${state} ${zip}`.trim();
}

function enrichSuggestions(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    ...item,
    formatted: formatSuggestionLabel(item),
    selected: buildSelectedToken(item),
    hasMultipleUnits: Number(item?.entries) > 1,
  }));
}

function addSmartyAuth(params) {
  const authId = (process.env.SMARTY_AUTH_ID || '').trim();
  const authToken = (process.env.SMARTY_AUTH_TOKEN || '').trim();
  const apiKey = (process.env.SMARTY_API_KEY || '').trim();
  
  const hasAuthId = !!authId;
  const hasAuthToken = !!authToken;
  const hasApiKey = !!apiKey;
  
  console.log('[AddressController] Checking SMARTY credentials:', {
    hasAuthId,
    hasAuthToken,
    hasApiKey,
    authIdLength: authId.length,
    authTokenLength: authToken.length,
    apiKeyLength: apiKey.length,
  });
  
  if (authId && authToken) {
    params.set('auth-id', authId);
    params.set('auth-token', authToken);
    console.log('[AddressController] Using auth-id and auth-token for authentication');
    return true;
  }
  if (apiKey) {
    params.set('key', apiKey);
    console.log('[AddressController] Using API key for authentication');
    return true;
  }
  
  console.error('[AddressController] ❌ No SMARTY credentials found!');
  console.error('[AddressController] Need either:');
  console.error('[AddressController]   - SMARTY_AUTH_ID + SMARTY_AUTH_TOKEN (Secret Key)');
  console.error('[AddressController]   - OR SMARTY_API_KEY (Public Key)');
  console.error('[AddressController] Get credentials from: https://smarty.com/account/keys');
  
  return false;
}

function httpsGet(urlString, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlString, (res) => {
      clearTimeout(timer);
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          resolve({ statusCode: res.statusCode, data });
        } catch {
          resolve({ statusCode: res.statusCode, data: null });
        }
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('Request timeout'));
    }, timeoutMs);
  });
}

/**
 * GET /api/address/autocomplete
 * Query: search (string, min 3 chars)
 */
export const autocomplete = async (req, res) => {
  try {
    const raw = req.query?.search;
    const rawSelected = req.query?.selected;
    const search = sanitizeSearch(raw ?? '');
    const selected = sanitizeSearch(rawSelected ?? '');
    console.log('[AddressController] Autocomplete request:', {
      search,
      selected: selected ? '(set)' : '',
      length: search.length,
    });

    if (!selected && search.length < MIN_SEARCH_LENGTH) {
      return res.json({
        success: true,
        suggestions: [],
        message: `Type at least ${MIN_SEARCH_LENGTH} characters`,
      });
    }
    const params = new URLSearchParams();
    const hasSmartyAuth = addSmartyAuth(params);
    if (!hasSmartyAuth) {
      if (fallbackEnabled() && search.length >= MIN_SEARCH_LENGTH) {
        const suggestions = await autocompleteViaFallback(search);
        return res.json({
          success: true,
          suggestions,
          provider: 'nominatim',
        });
      }
      return res.status(503).json({
        success: false,
        message: 'Address service unavailable. Configure SMARTY credentials or enable ADDRESS_FALLBACK_ENABLED.',
        suggestions: [],
      });
    }
    if (selected) {
      params.set('selected', selected);
      if (search) params.set('search', search);
    } else {
      params.set('search', search);
    }
    const urlString = `https://${SMARTY_AUTOCOMPLETE_HOST}/lookup?${params.toString()}`;
    console.log('[AddressController] Calling Smarty API:', urlString.replace(/auth-id=[^&]+/g, 'auth-id=***').replace(/auth-token=[^&]+/g, 'auth-token=***'));
    
    let statusCode = 200;
    let data = null;
    try {
      const result = await httpsGet(urlString, AUTOCOMPLETE_TIMEOUT_MS);
      statusCode = result.statusCode;
      data = result.data;
      console.log('[AddressController] Smarty API response:', { statusCode, hasData: !!data, suggestionsCount: Array.isArray(data?.suggestions) ? data.suggestions.length : (Array.isArray(data) ? data.length : 0) });
    } catch (err) {
      console.error('[AddressController] ❌ Smarty API request failed:', err.message);
      if (fallbackEnabled() && search.length >= MIN_SEARCH_LENGTH) {
        try {
          const suggestions = await autocompleteViaFallback(search);
          if (suggestions.length > 0) {
            return res.json({ success: true, suggestions, provider: 'nominatim' });
          }
        } catch (fbErr) {
          console.error('[AddressController] Fallback failed:', fbErr.message);
        }
      }
      return res.status(502).json({
        success: false,
        message: 'Failed to connect to address service',
        suggestions: [],
      });
    }
    if (statusCode !== 200) {
      console.error('[AddressController] ❌ Smarty API returned status:', statusCode);
      console.error('[AddressController] Response data:', JSON.stringify(data, null, 2));
      
      if (statusCode === 401 || statusCode === 402) {
        const smartyMsg =
          data?.errors?.[0]?.message || data?.message || 'Smarty subscription inactive';
        console.warn('[AddressController] Smarty unavailable:', statusCode, smartyMsg);
        if (fallbackEnabled() && search.length >= MIN_SEARCH_LENGTH) {
          try {
            const suggestions = await autocompleteViaFallback(search);
            if (suggestions.length > 0) {
              return res.json({
                success: true,
                suggestions,
                provider: 'nominatim',
                smartyStatus: statusCode,
              });
            }
          } catch (fbErr) {
            console.error('[AddressController] Fallback failed:', fbErr.message);
          }
        }
        return res.status(503).json({
          success: false,
          message:
            'US address lookup is temporarily unavailable. Enable US Autocomplete on your Smarty account, or try a more specific U.S. street search.',
          suggestions: [],
          details: { statusCode, smarty: smartyMsg },
        });
      }
      if (statusCode === 429) {
        return res.status(429).json({
          success: false,
          message: 'Too many requests',
          suggestions: [],
        });
      }
      if (statusCode >= 500) {
        return res.status(502).json({
          success: false,
          message: 'Address service error',
          suggestions: [],
        });
      }
      return res.status(502).json({
        success: false,
        message: 'Address service returned an error',
        suggestions: [],
      });
    }
    const rawSuggestions = Array.isArray(data?.suggestions)
      ? data.suggestions
      : Array.isArray(data)
        ? data
        : [];
    const suggestions = enrichSuggestions(rawSuggestions);
    const preview = suggestions.slice(0, 5).map((item, index) => ({
      index,
      street_line: item?.street_line || '',
      secondary: item?.secondary || '',
      entries: item?.entries ?? null,
      city: item?.city || '',
      state: item?.state || '',
      zipcode: item?.zipcode || '',
      hasUnitOrApt: !!(item?.secondary && String(item.secondary).trim()),
    }));
    console.log('[AddressController] Suggestions preview (unit/apt check):', JSON.stringify(preview, null, 2));
    console.log('[AddressController] Suggestions with unit/apt:', suggestions.filter((item) => !!(item?.secondary && String(item.secondary).trim())).length);
    console.log('[AddressController] ✅ Returning suggestions:', suggestions.length);
    return res.json({ success: true, suggestions });
  } catch (err) {
    console.error('[AddressController] ❌ Unexpected error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      suggestions: [],
    });
  }
};

/**
 * POST /api/address/validate
 * Body: { street, city, state }
 */
export const validate = async (req, res) => {
  try {
    const { street, city, state, secondary, zipcode, zip } = req.body || {};
    const streetStr = typeof street === 'string' ? street.trim() : '';
    const cityStr = typeof city === 'string' ? city.trim() : '';
    const stateStr = typeof state === 'string' ? state.trim() : '';
    const secondaryStr = typeof secondary === 'string' ? secondary.trim() : '';
    const zipStr =
      typeof zipcode === 'string'
        ? zipcode.trim()
        : typeof zip === 'string'
          ? zip.trim()
          : '';
    if (!streetStr || !cityStr || !stateStr) {
      return res.status(400).json({
        success: false,
        message: 'street, city, and state are required',
      });
    }
    const params = new URLSearchParams();
    if (!addSmartyAuth(params)) {
      return res.status(503).json({
        success: false,
        message: 'Address service unavailable. Set SMARTY_AUTH_ID and SMARTY_AUTH_TOKEN in .env (Secret Key from smarty.com/account/keys).',
      });
    }
    params.set('street', streetStr);
    if (secondaryStr) params.set('secondary', secondaryStr);
    params.set('city', cityStr);
    params.set('state', stateStr);
    if (zipStr) params.set('zipcode', zipStr);
    params.set('candidates', '1');
    const urlString = `https://${SMARTY_STREET_HOST}/street-address?${params.toString()}`;
    const { statusCode, data } = await httpsGet(urlString, VALIDATE_TIMEOUT_MS);
    if (statusCode !== 200) {
      if (statusCode === 401 || statusCode === 402) {
        if (fallbackEnabled()) {
          const validated = validatedFromSuggestion({
            street_line: streetStr,
            secondary: secondaryStr,
            city: cityStr,
            state: stateStr,
            zipcode: zipStr,
            source: 'nominatim',
          });
          return res.json({ success: true, data: validated, provider: 'nominatim' });
        }
        return res.status(503).json({
          success: false,
          message: 'Address validation unavailable. Activate Smarty US Street API on your account.',
        });
      }
      if (statusCode === 429) {
        return res.status(429).json({
          success: false,
          message: 'Too many requests',
        });
      }
      return res.status(502).json({
        success: false,
        message: 'Address validation failed',
      });
    }
    const candidates = Array.isArray(data) ? data : [];
    if (candidates.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No valid address found',
      });
    }
    const first = candidates[0];
    const components = first.components || {};
    const metadata = first.metadata || {};
    const validated = {
      delivery_line_1: first.delivery_line_1 || '',
      delivery_line_2: first.delivery_line_2 || '',
      last_line: first.last_line || '',
      street: first.delivery_line_1 || streetStr,
      secondary: first.delivery_line_2 || secondaryStr || '',
      city: components.city_name || cityStr,
      state: components.state_abbreviation || stateStr,
      zipcode: components.zipcode || zipStr,
      county: metadata.county_name || components.county_name || '',
      plus4_code: components.plus4_code || '',
      formatted: [
        first.delivery_line_1,
        first.delivery_line_2,
        first.last_line,
      ]
        .filter(Boolean)
        .join(', '),
    };
    return res.json({ success: true, data: validated });
  } catch (err) {
    const status = err.message === 'Request timeout' ? 504 : 500;
    return res.status(status).json({
      success: false,
      message: status === 504 ? 'Address validation timed out' : 'Address validation failed',
    });
  }
};
