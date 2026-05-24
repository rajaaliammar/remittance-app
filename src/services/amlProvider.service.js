/**
 * LiveEx TMS AML provider — all calls go through Remittance_backend (never from frontend).
 * Docs: https://amlhlep.com/UET_TMSSwaggerAPI
 */

const AML_TIMEOUT_MS = parseInt(process.env.AML_REQUEST_TIMEOUT_MS || '30000', 10);
const AML_LOG = process.env.AML_LOG !== 'false';

/** Read from process.env when used (not at import) so .env changes apply after restart. */
function amlConfig() {
  return {
    baseUrl: process.env.AML_BASE_URL || 'https://amlhlep.com/UET_TMSSwaggerAPI',
    code: parseInt(process.env.AML_CODE || '9001', 10),
    username: process.env.AML_USERNAME || '',
    password: process.env.AML_PASSWORD || '',
  };
}

function clearAmlTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

let cachedToken = null;
let tokenExpiresAt = 0;

export const CUSTOMER_STATUS_LABELS = {
  1: 'Validate Pending',
  2: 'Mobile Verification Requested',
  3: 'Mobile Verification Completed',
  4: 'Pending Compliance (Case)',
  5: 'Pending Compliance (SAR)',
  6: 'Onboarded',
  7: 'Customer Blocked',
  8: 'Customer Disabled',
  9: 'Reject',
  10: 'Validate Pending (App)',
};

function log(message, ...args) {
  if (AML_LOG) console.log(`[AML] ${message}`, ...args);
}

function logError(message, ...args) {
  console.error(`[AML] ${message}`, ...args);
}

/** Format date as dd/MM/yyyy for AML API */
export function toAmlDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

/** Customer listing query dates must be dd/MM/yyyy (not ISO). */
export function toAmlListingQueryDate(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return toAmlDate(input);
}

export function resolveAmlClientNumber(customer) {
  const raw = customer?.kycData;
  if (Array.isArray(raw)) {
    for (let i = raw.length - 1; i >= 0; i -= 1) {
      const entry = raw[i];
      if (entry?.amlClientNumber) return String(entry.amlClientNumber);
      if (entry?.aml?.clientNumber) return String(entry.aml.clientNumber);
    }
  } else if (raw && typeof raw === 'object') {
    if (raw.amlClientNumber) return String(raw.amlClientNumber);
    if (raw.aml?.clientNumber) return String(raw.aml.clientNumber);
  }
  return `CS_${String(customer.id).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;
}

export function mapAmlCustomerStatus(amlResponse) {
  if (!amlResponse || typeof amlResponse !== 'object') {
    return { statusId: null, statusLabel: 'Unknown' };
  }

  const rawId =
    amlResponse.statusId ??
    amlResponse.statusID ??
    amlResponse.StatusId ??
    null;
  const statusId =
    rawId === null || rawId === undefined || rawId === ''
      ? null
      : parseInt(String(rawId), 10);

  const label =
    amlResponse.customerStatus ||
    amlResponse.customeR_STATUS ||
    amlResponse.CUSTOMER_STATUS ||
    CUSTOMER_STATUS_LABELS[statusId] ||
    'Unknown';

  return {
    statusId: Number.isNaN(statusId) ? null : statusId,
    statusLabel: label,
    pin: amlResponse.Pin || amlResponse.pin || null,
    clientNumber:
      amlResponse.clientNumber || amlResponse.ClientNumber || null,
    isOnboarded: statusId === 6,
    isBlocked: statusId === 7 || statusId === 8 || statusId === 9,
    isFrozen:
      statusId === 4 || statusId === 5 || statusId === 1 || statusId === 10,
    riskScore: amlResponse.riskScore ?? null,
    rowIdGid:
      amlResponse.rowIdGid ||
      amlResponse.roW_ID_GID ||
      amlResponse.ROW_ID_GID ||
      null,
    sanctionDetails:
      amlResponse.sanctionDetails ||
      amlResponse.sanctioN_DETAILS ||
      amlResponse.SANCTION_DETAILS ||
      null,
    rbaDetails:
      amlResponse.rbaDetails ||
      amlResponse.rbA_DETAILS ||
      amlResponse.RBA_DETAILS ||
      null,
    smartRules:
      amlResponse.smartRules ||
      amlResponse.smarT_RULES ||
      amlResponse.Smart_RULES ||
      null,
    message: amlResponse.message ?? null,
    isError: Boolean(amlResponse.isError),
    messageCode: amlResponse.messageCode ?? null,
    messageDetails: amlResponse.messageDetails ?? null,
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AML_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractTokenFromLoginBody(data, rawText) {
  if (data && typeof data === 'object') {
    if (data.token) return String(data.token);
    if (data.Token) return String(data.Token);
    if (data.access_token) return String(data.access_token);
  }
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return extractTokenFromLoginBody(parsed, '');
    } catch {
      /* fall through */
    }
  }
  return trimmed.replace(/^"|"$/g, '');
}

async function loginAml() {
  const { baseUrl, code, username, password } = amlConfig();
  if (!username?.trim() || !password) {
    throw new Error(
      'AML credentials missing. Set AML_USERNAME and AML_PASSWORD in Remittance_backend/.env (quote passwords containing #).',
    );
  }
  log('POST /api/Auth/login — authenticating…');
  const res = await fetchWithTimeout(`${baseUrl}/api/Auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      Code: code,
      User_Name: username,
      Password: password,
    }),
  });

  const rawText = await res.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { raw: rawText };
  }

  if (!res.ok) {
    const rawMsg =
      typeof data === 'string'
        ? data
        : data?.raw || data?.message || rawText;
    const hint =
      res.status === 401
        ? 'AML provider rejected credentials (401). Update AML_USERNAME and AML_PASSWORD in Remittance_backend/.env with valid LiveEx TMS credentials.'
        : '';
    logError(`Login failed HTTP ${res.status}`, rawMsg || data);
    throw new Error(
      hint || rawMsg || `AML login failed (${res.status})`,
    );
  }

  const token = extractTokenFromLoginBody(data, rawText);
  if (!token) {
    logError('Login OK but no token in response', data);
    throw new Error('AML login returned empty token');
  }

  const ttlSec = parseInt(process.env.AML_TOKEN_TTL_SECONDS || '3300', 10);
  cachedToken = token;
  tokenExpiresAt = Date.now() + ttlSec * 1000;
  log(`Login success — token cached (${token.slice(0, 16)}…, TTL ${ttlSec}s)`);
  return token;
}

async function getAmlToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }
  return loginAml();
}

function isAmlAuthorizationFailed(data) {
  const msg = String(data?.message || '').toLowerCase();
  return Boolean(data?.isError) && msg.includes('authorization failed');
}

async function amlRequest(method, path, body, retried = false) {
  const { baseUrl } = amlConfig();
  const token = await getAmlToken();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const label = `${method} ${path}`;

  log(`${label} — request`);
  if (body && AML_LOG) {
    log(`${label} — body keys:`, Object.keys(body).join(', '));
  }

  const res = await fetchWithTimeout(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !retried) {
    log(`${label} — 401, refreshing token…`);
    clearAmlTokenCache();
    return amlRequest(method, path, body, true);
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text === 'true' || text === 'false' ? text === 'true' : { raw: text };
  }

  if (isAmlAuthorizationFailed(data) && !retried) {
    log(`${label} — provider Authorization Failed, refreshing token and retrying…`);
    clearAmlTokenCache();
    return amlRequest(method, path, body, true);
  }

  if (!res.ok) {
    logError(`${label} — HTTP ${res.status}`, data);
    const err = new Error(
      data?.title ||
        data?.message ||
        data?.messageDetails ||
        `AML API error (${res.status})`,
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }

  const mapped = mapAmlCustomerStatus(data);
  if (mapped.statusLabel && mapped.statusLabel !== 'Unknown') {
    log(
      `${label} — OK → ${mapped.statusLabel} (statusId: ${mapped.statusId ?? 'n/a'})`,
    );
  } else if (data?.message) {
    log(`${label} — OK → ${data.message}`);
  } else {
    log(`${label} — OK`);
  }

  return data;
}

export function logAmlStartupConfig() {
  const { baseUrl, code, username, password } = amlConfig();
  const configured = Boolean(username && password);
  console.log('────────────────────────────────────────');
  console.log('[AML] LiveEx TMS integration (Remittance_backend)');
  console.log(`[AML] Base URL: ${baseUrl}`);
  console.log(`[AML] Code: ${code} | User: ${username || '(not set)'}`);
  if (password && !password.includes('#') && password.length < 12) {
    console.warn(
      '[AML] Tip: if your password contains #, use AML_PASSWORD="your#password" in .env',
    );
  }
  console.log(
    `[AML] Status: ${configured ? 'CONFIGURED — verifying login…' : 'MISSING CREDENTIALS — set AML_USERNAME/AML_PASSWORD in .env'}`,
  );
  console.log('[AML] Portal routes:');
  console.log('[AML]   GET  /api/customers/:id/aml/status');
  console.log('[AML]   POST /api/customers/:id/aml/validate');
  console.log('[AML]   POST /api/customers/:id/aml/onboard');
  console.log('[AML]   POST /api/customers/:id/aml/case-clear');
  console.log('[AML]   POST /api/customers/:id/aml/documents/upload');
  console.log('────────────────────────────────────────');
}

/** Login once at startup so bad .env or stale tokens fail early, not on first signup. */
export async function verifyAmlConnectionAtStartup() {
  const { username, password } = amlConfig();
  if (!username?.trim() || !password) {
    return { ok: false, reason: 'AML_USERNAME or AML_PASSWORD not set in .env' };
  }
  try {
    clearAmlTokenCache();
    await loginAml();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message || 'AML login failed' };
  }
}

export async function amlCheckCustomerExists(clientNumber) {
  return amlRequest(
    'GET',
    `/api/Customers/check-exists/${encodeURIComponent(clientNumber)}`,
  );
}

export async function amlGetCustomerStatus(clientNumber) {
  return amlRequest(
    'GET',
    `/api/Customers/status/${encodeURIComponent(clientNumber)}`,
  );
}

export async function amlValidateCustomer(clientNumber) {
  return amlRequest(
    'POST',
    `/api/Customers/validate/${encodeURIComponent(clientNumber)}`,
    {},
  );
}

export async function amlSaveCustomer(payload) {
  return amlRequest('POST', '/api/Customers/save', payload);
}

export async function amlUploadDocuments(payload) {
  return amlRequest('POST', '/api/Customers/documents', payload);
}

export async function amlGetDocuments(clientNumber, searchValue = '') {
  const qs = new URLSearchParams();
  qs.set('ClientNumber', clientNumber);
  if (searchValue?.trim()) {
    qs.set('SearchValue', searchValue.trim());
  }
  return amlRequest('GET', `/api/Customers/documents?${qs.toString()}`);
}

export async function amlClearCustomerCase(clientNumber, remarks) {
  return amlRequest('POST', '/api/Customers/case-clear', {
    ClientNumber: clientNumber,
    Remarks: remarks,
  });
}

export async function amlUpdateCustomerName(clientNumber, names) {
  return amlRequest(
    'PUT',
    `/api/Customers/update-name?ClientNumber=${encodeURIComponent(clientNumber)}`,
    {
      clientNumber,
      givenName: names.givenName,
      surname: names.surname,
      otherInitial: names.otherInitial || '',
    },
  );
}

function guessMimeType(fileName) {
  const ext = String(fileName || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  const map = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

/** Try to download a document binary from the AML host using provider filepath + token. */
export async function amlFetchDocumentBinary(filepath, fileName = '') {
  const normalized = String(filepath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\//, '');
  if (!normalized) return null;

  const { baseUrl } = amlConfig();
  const token = await getAmlToken();
  const hostRoot = baseUrl.replace(/\/UET_TMSSwaggerAPI\/?$/i, '');
  const candidates = [
    `${baseUrl}/${normalized}`,
    `${hostRoot}/${normalized}`,
    `${hostRoot}/UET_TMSSwaggerAPI/${normalized}`,
  ];

  for (const url of [...new Set(candidates)]) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          accept: '*/*',
        },
      });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) continue;
      return {
        buffer,
        contentType: contentType.split(';')[0] || guessMimeType(fileName),
      };
    } catch (err) {
      log(`Document fetch failed (${url}):`, err.message);
    }
  }
  return null;
}

export async function amlListCustomers(startDate, endDate) {
  const qs = new URLSearchParams();
  const amlStart = toAmlListingQueryDate(startDate);
  const amlEnd = toAmlListingQueryDate(endDate);
  if (amlStart) qs.set('startDate', amlStart);
  if (amlEnd) qs.set('endDate', amlEnd);
  const q = qs.toString();
  return amlRequest(
    'GET',
    `/api/Customers/listing${q ? `?${q}` : ''}`,
  );
}
