import https from 'https';

const SMARTY_AUTOCOMPLETE_HOST = 'us-autocomplete-pro.api.smarty.com';
const SMARTY_STREET_HOST = 'us-street.api.smarty.com';
const VALIDATE_TIMEOUT_MS = 5000;
const AUTOCOMPLETE_TIMEOUT_MS = 8000;
const MIN_SEARCH_LENGTH = 3;
const MAX_SEARCH_LENGTH = 200;

function sanitizeSearch(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_LENGTH);
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
    const search = sanitizeSearch(raw ?? '');
    console.log('[AddressController] Autocomplete request:', { search, length: search.length });
    
    if (search.length < MIN_SEARCH_LENGTH) {
      console.log('[AddressController] Search too short:', search.length);
      return res.status(400).json({
        success: false,
        message: `Search must be at least ${MIN_SEARCH_LENGTH} characters`,
      });
    }
    const params = new URLSearchParams();
    if (!addSmartyAuth(params)) {
      console.error('[AddressController] ❌ SMARTY credentials not configured! Set SMARTY_AUTH_ID and SMARTY_AUTH_TOKEN in .env');
      return res.status(503).json({
        success: false,
        message: 'Address service unavailable. SMARTY API credentials not configured.',
        suggestions: [],
      });
    }
    params.set('search', search);
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
        const errorMsg = data?.message || data?.error || 'Authentication failed';
        console.error('[AddressController] ❌ Authentication failed!');
        console.error('[AddressController] This usually means:');
        console.error('[AddressController]   1. SMARTY_AUTH_ID or SMARTY_AUTH_TOKEN is incorrect');
        console.error('[AddressController]   2. Credentials are for wrong environment (test vs production)');
        console.error('[AddressController]   3. Account is suspended or has no credits');
        console.error('[AddressController] Check your credentials at: https://smarty.com/account/keys');
        
        return res.status(503).json({
          success: false,
          message: `Address service authentication failed: ${errorMsg}. Please verify your SMARTY credentials in .env file.`,
          suggestions: [],
          details: {
            statusCode,
            error: errorMsg,
            hint: 'Check SMARTY_AUTH_ID and SMARTY_AUTH_TOKEN in your .env file, or get new credentials from https://smarty.com/account/keys',
          },
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
    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : (Array.isArray(data) ? data : []);
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
    const { street, city, state } = req.body || {};
    const streetStr = typeof street === 'string' ? street.trim() : '';
    const cityStr = typeof city === 'string' ? city.trim() : '';
    const stateStr = typeof state === 'string' ? state.trim() : '';
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
    params.set('city', cityStr);
    params.set('state', stateStr);
    params.set('candidates', '1');
    const urlString = `https://${SMARTY_STREET_HOST}/street-address?${params.toString()}`;
    const { statusCode, data } = await httpsGet(urlString, VALIDATE_TIMEOUT_MS);
    if (statusCode !== 200) {
      if (statusCode === 401 || statusCode === 402) {
        return res.status(503).json({
          success: false,
          message: 'Address service unavailable. Use Secret Key (SMARTY_AUTH_ID and SMARTY_AUTH_TOKEN) from smarty.com/account/keys for server-side.',
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
    const validated = {
      delivery_line_1: first.delivery_line_1 || '',
      delivery_line_2: first.delivery_line_2 || '',
      last_line: first.last_line || '',
      street: first.delivery_line_1 || '',
      city: components.city_name || '',
      state: components.state_abbreviation || '',
      zipcode: components.zipcode || '',
      plus4_code: components.plus4_code || '',
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
