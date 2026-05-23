/**
 * LiveEx TMS AML provider — all calls go through Remittance_backend (never from frontend).
 * Docs: https://amlhlep.com/UET_TMSSwaggerAPI
 */

const AML_BASE_URL =
  process.env.AML_BASE_URL || 'https://amlhlep.com/UET_TMSSwaggerAPI';
const AML_CODE = parseInt(process.env.AML_CODE || '9001', 10);
const AML_USERNAME = process.env.AML_USERNAME || '';
const AML_PASSWORD = process.env.AML_PASSWORD || '';
const AML_TIMEOUT_MS = parseInt(process.env.AML_REQUEST_TIMEOUT_MS || '30000', 10);
const AML_LOG = process.env.AML_LOG !== 'false';

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

export function resolveAmlClientNumber(customer) {
  const kyc = customer?.kycData && typeof customer.kycData === 'object' ? customer.kycData : {};
  if (kyc.amlClientNumber) return String(kyc.amlClientNumber);
  if (kyc.aml?.clientNumber) return String(kyc.aml.clientNumber);
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
  log('POST /api/Auth/login — authenticating…');
  const res = await fetchWithTimeout(`${AML_BASE_URL}/api/Auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      Code: AML_CODE,
      User_Name: AML_USERNAME,
      Password: AML_PASSWORD,
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

async function amlRequest(method, path, body, retried = false) {
  const token = await getAmlToken();
  const url = `${AML_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
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
    cachedToken = null;
    tokenExpiresAt = 0;
    return amlRequest(method, path, body, true);
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text === 'true' || text === 'false' ? text === 'true' : { raw: text };
  }

  if (!res.ok) {
    logError(`${label} — HTTP ${res.status}`, data);
    const err = new Error(
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
  const configured = Boolean(AML_USERNAME && AML_PASSWORD);
  console.log('────────────────────────────────────────');
  console.log('[AML] LiveEx TMS integration (Remittance_backend)');
  console.log(`[AML] Base URL: ${AML_BASE_URL}`);
  console.log(`[AML] Code: ${AML_CODE} | User: ${AML_USERNAME || '(not set)'}`);
  console.log(
    `[AML] Status: ${configured ? 'CONFIGURED — ready' : 'MISSING CREDENTIALS — set AML_USERNAME/AML_PASSWORD in .env'}`,
  );
  console.log('[AML] Portal routes:');
  console.log('[AML]   GET  /api/customers/:id/aml/status');
  console.log('[AML]   POST /api/customers/:id/aml/validate');
  console.log('[AML]   POST /api/customers/:id/aml/onboard');
  console.log('[AML]   POST /api/customers/:id/aml/case-clear');
  console.log('────────────────────────────────────────');
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

export async function amlGetDocuments(clientNumber) {
  return amlRequest(
    'GET',
    `/api/Customers/documents/${encodeURIComponent(clientNumber)}`,
  );
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

export async function amlListCustomers(startDate, endDate) {
  const qs = new URLSearchParams();
  if (startDate) qs.set('startDate', startDate);
  if (endDate) qs.set('endDate', endDate);
  const q = qs.toString();
  return amlRequest(
    'GET',
    `/api/Customers/listing${q ? `?${q}` : ''}`,
  );
}
