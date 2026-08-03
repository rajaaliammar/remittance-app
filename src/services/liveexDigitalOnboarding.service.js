/**
 * LiveEx Digital Onboarding (LiveExShield) — face match, ID OCR, liveness, screening.
 * Base: https://amlhlep.com/TMSDigitalOnboardingWeb
 * Separate from LiveEx TMS (`amlProvider.service.js`).
 */

const LOG = process.env.LIVEEX_ONBOARD_LOG !== 'false';

function config() {
  const enabledRaw = process.env.LIVEEX_DIGITAL_ONBOARDING_ENABLED;
  const enabled =
    enabledRaw == null || enabledRaw === ''
      ? true
      : !['0', 'false', 'no', 'off'].includes(String(enabledRaw).toLowerCase());

  return {
    enabled,
    baseUrl: (
      process.env.LIVEEX_ONBOARD_BASE_URL ||
      'https://amlhlep.com/TMSDigitalOnboardingWeb'
    ).replace(/\/$/, ''),
    companyCode: parseInt(
      process.env.LIVEEX_ONBOARD_COMPANY_CODE || process.env.AML_CODE || '3004',
      10,
    ),
    username:
      process.env.LIVEEX_ONBOARD_USERNAME || process.env.AML_USERNAME || '',
    password:
      process.env.LIVEEX_ONBOARD_PASSWORD || process.env.AML_PASSWORD || '',
    timeoutMs: parseInt(
      process.env.LIVEEX_ONBOARD_TIMEOUT_MS ||
        process.env.AML_REQUEST_TIMEOUT_MS ||
        '60000',
      10,
    ),
    tokenTtlSeconds: parseInt(
      process.env.LIVEEX_ONBOARD_TOKEN_TTL_SECONDS || '28000',
      10,
    ),
  };
}

let cachedToken = null;
let tokenExpiresAt = 0;

function log(message, ...args) {
  if (LOG) console.log(`[LiveEx-Onboard] ${message}`, ...args);
}

function logError(message, ...args) {
  console.error(`[LiveEx-Onboard] ${message}`, ...args);
}

export function isDigitalOnboardingEnabled() {
  return config().enabled;
}

export function getDigitalOnboardingPublicStatus() {
  const cfg = config();
  return {
    enabled: cfg.enabled,
    configured: Boolean(cfg.username && cfg.password && cfg.companyCode),
    baseUrl: cfg.baseUrl,
  };
}

function assertConfigured() {
  const cfg = config();
  if (!cfg.enabled) {
    const err = new Error('LiveEx Digital Onboarding is disabled');
    err.status = 503;
    err.code = 'LIVEEX_ONBOARD_DISABLED';
    throw err;
  }
  if (!cfg.username || !cfg.password) {
    const err = new Error(
      'LiveEx Digital Onboarding credentials are not configured',
    );
    err.status = 503;
    err.code = 'LIVEEX_ONBOARD_NOT_CONFIGURED';
    throw err;
  }
  return cfg;
}

async function parseJsonSafe(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isBusinessError(body) {
  if (!body || typeof body !== 'object') return false;
  return body.isErrorMessage === true || body.isError === true;
}

async function liveexFetch(path, { method = 'GET', body, token } = {}) {
  const cfg = assertConfigured();
  const url = `${cfg.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  log(`${method} ${path}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await parseJsonSafe(res);

    if (res.status === 401) {
      const err = new Error('LiveEx Digital Onboarding token expired or invalid');
      err.status = 401;
      err.code = 'LIVEEX_ONBOARD_UNAUTHORIZED';
      err.data = data;
      throw err;
    }

    if (!res.ok) {
      const detail =
        data?.message ||
        data?.messageDetails ||
        (typeof data === 'string' ? data : null) ||
        `LiveEx Digital Onboarding HTTP ${res.status}`;
      logError(`${method} ${path} failed HTTP ${res.status}:`, detail, data);
      const err = new Error(detail);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    // LiveEx often returns HTTP 200 with isErrorMessage:true (e.g. face mismatch)
    if (data && typeof data === 'object' && data.isErrorMessage === true) {
      const detail = data.message || data.messageCode || 'LiveEx business validation failed';
      logError(`${method} ${path} business error:`, detail);
      const err = new Error(detail);
      err.status = 400;
      err.code = data.messageCode || 'LIVEEX_ONBOARD_ERROR';
      err.data = data;
      throw err;
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('LiveEx Digital Onboarding request timed out');
      timeoutErr.status = 504;
      timeoutErr.code = 'LIVEEX_ONBOARD_TIMEOUT';
      throw timeoutErr;
    }
    // Surface DNS / network root cause (e.g. ENOTFOUND for api.liveexshield.com)
    if (
      err.message === 'fetch failed' ||
      err.cause?.code === 'ENOTFOUND' ||
      err.cause?.code === 'ECONNREFUSED'
    ) {
      const causeCode = err.cause?.code || 'NETWORK_ERROR';
      const netErr = new Error(
        `Cannot reach LiveEx Digital Onboarding at ${cfg.baseUrl} (${causeCode}). ` +
          'Confirm LIVEEX_ONBOARD_BASE_URL (expected https://amlhlep.com/TMSDigitalOnboardingWeb).',
      );
      netErr.status = 502;
      netErr.code = 'LIVEEX_ONBOARD_UNREACHABLE';
      netErr.data = { baseUrl: cfg.baseUrl, causeCode };
      throw netErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function clearDigitalOnboardingTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

export async function liveexOnboardLogin({ force = false } = {}) {
  const cfg = assertConfigured();
  const now = Date.now();
  if (!force && cachedToken && tokenExpiresAt > now + 60_000) {
    return cachedToken;
  }

  log('POST /api/auth/login — authenticating partner…');
  const data = await liveexFetch('/api/auth/login', {
    method: 'POST',
    body: {
      companyCode: cfg.companyCode,
      username: cfg.username,
      password: cfg.password,
    },
  });

  if (isBusinessError(data) || !data?.token) {
    const err = new Error(data?.message || 'LiveEx Digital Onboarding login failed');
    err.status = 401;
    err.code = 'LIVEEX_ONBOARD_LOGIN_FAILED';
    err.data = data;
    throw err;
  }

  cachedToken = data.token;
  tokenExpiresAt = now + cfg.tokenTtlSeconds * 1000;
  log(`Login success — token cached (TTL ${cfg.tokenTtlSeconds}s)`);
  return cachedToken;
}

async function withAuth(fn) {
  let token = await liveexOnboardLogin();
  try {
    return await fn(token);
  } catch (err) {
    if (err.status === 401 || err.code === 'LIVEEX_ONBOARD_UNAUTHORIZED') {
      clearDigitalOnboardingTokenCache();
      token = await liveexOnboardLogin({ force: true });
      return fn(token);
    }
    throw err;
  }
}

function assertSuccess(data, fallbackMessage) {
  if (isBusinessError(data)) {
    const err = new Error(data?.message || fallbackMessage);
    err.status = 400;
    err.code = data?.messageCode || 'LIVEEX_ONBOARD_ERROR';
    err.data = data;
    throw err;
  }
  return data;
}

export async function liveexLookup(path) {
  const cfg = assertConfigured();
  const url = `${cfg.baseUrl}${path}`;
  log(`GET ${path} (public)`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      const err = new Error(data?.message || `Lookup HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const liveexLookupSourceOfFund = () =>
  liveexLookup('/api/lookups/source-of-fund');
export const liveexLookupCountries = () => liveexLookup('/api/lookups/countries');
export const liveexLookupPurposes = () => liveexLookup('/api/lookups/purposes');
export const liveexLookupJobTitles = () => liveexLookup('/api/lookups/job-titles');
export const liveexLookupIndustries = () => liveexLookup('/api/lookups/industries');

export async function liveexSendOtp({ email, title, subject } = {}) {
  return withAuth(async (token) => {
    const data = await liveexFetch('/api/otp/send', {
      method: 'POST',
      token,
      body: {
        email,
        ...(title ? { title } : {}),
        ...(subject ? { subject } : {}),
      },
    });
    return assertSuccess(data, 'Failed to send LiveEx OTP');
  });
}

export async function liveexVerifyOtp({ email, otp } = {}) {
  return withAuth(async (token) => {
    const data = await liveexFetch('/api/otp/verify', {
      method: 'POST',
      token,
      body: { email, otp },
    });
    return assertSuccess(data, 'LiveEx OTP verification failed');
  });
}

export async function liveexSaveWebsite(payload) {
  return withAuth(async (token) => {
    const data = await liveexFetch('/api/customer/save-website', {
      method: 'POST',
      token,
      body: payload,
    });
    return assertSuccess(data, 'Failed to save LiveEx applicant profile');
  });
}

export async function liveexTempDocument(payload) {
  return withAuth(async (token) => {
    const data = await liveexFetch('/api/customer/temp-document', {
      method: 'POST',
      token,
      body: payload,
    });
    return assertSuccess(data, 'Failed to upload LiveEx identity image');
  });
}

export async function liveexCustomerDetails({ rowIdGid, email } = {}) {
  return withAuth(async (token) => {
    const data = await liveexFetch('/api/customer/details', {
      method: 'POST',
      token,
      body: { rowIdGid, email },
    });
    return assertSuccess(data, 'Failed to load LiveEx applicant details');
  });
}

export async function liveexSubmitKyc(payload) {
  return withAuth(async (token) => {
    const row = String(
      payload?.roW_ID_GID ||
        payload?.rowIdGid ||
        payload?.rowId ||
        payload?.ROW_ID_GID ||
        '',
    ).trim();
    if (!row) {
      const err = new Error(
        'LiveEx submit-kyc blocked: roW_ID_GID is missing',
      );
      err.status = 400;
      err.code = 'LIVEEX_ROW_ID_REQUIRED';
      throw err;
    }

    const nameFront = String(
      payload?.namE_Front || payload?.nameFront || '',
    ).trim();
    const nameSelfie = String(
      payload?.namE_Selfie || payload?.nameSelfie || '',
    ).trim();
    const nameBack = String(
      payload?.namE_Back || payload?.nameBack || '',
    ).trim();
    const fullName = String(
      payload?.full_Name || payload?.fullName || 'Unknown',
    ).trim();
    const email = String(payload?.email || '').trim();
    const idType = Number(
      payload?.iD_TYPE ?? payload?.idType ?? 5,
    );

    if (!nameFront || !nameSelfie) {
      const err = new Error(
        'LiveEx submit-kyc blocked: namE_Front and namE_Selfie are required',
      );
      err.status = 400;
      err.code = 'LIVEEX_PATHS_REQUIRED';
      throw err;
    }

    // confirm fields must be strings — bool true fails ASP.NET System.String binding.
    const confirmRaw =
      payload?.confirm != null
        ? payload.confirm
        : payload?.Confirm != null
          ? payload.Confirm
          : 'true';
    const confirm =
      typeof confirmRaw === 'string' ? confirmRaw : String(Boolean(confirmRaw));
    const confirm2Raw =
      payload?.confirm_2 != null
        ? payload.confirm_2
        : payload?.confirm2 != null
          ? payload.confirm2
          : confirm;
    const confirm_2 =
      typeof confirm2Raw === 'string' ? confirm2Raw : String(Boolean(confirm2Raw));

    // LiveEx docs: exact mixed-case keys — clean camelCase silently fails to bind.
    const body = {
      roW_ID_GID: row,
      full_Name: fullName,
      email,
      iD_TYPE: idType,
      namE_Selfie: nameSelfie,
      namE_Front: nameFront,
      namE_Back: nameBack,
      qrCodeDetail:
        payload?.qrCodeDetail != null ? String(payload.qrCodeDetail) : '',
      // Aliases for builds that still read camelCase / alternate SP params
      rowIdGid: row,
      rowId: row,
      ROW_ID_GID: row,
      confirm,
      confirm_2,
      confirm2: confirm_2,
    };

    log(
      'submit-kyc legacy keys:',
      `roW_ID_GID=${row}`,
      `iD_TYPE=${idType}`,
      `namE_Front=${nameFront}`,
      `namE_Back=${nameBack || '(empty)'}`,
      `namE_Selfie=${nameSelfie}`,
    );
    const data = await liveexFetch('/api/customer/submit-kyc', {
      method: 'POST',
      token,
      body,
    });
    return assertSuccess(data, 'LiveEx KYC submission failed');
  });
}

export function logDigitalOnboardingStartup() {
  const status = getDigitalOnboardingPublicStatus();
  console.log('[LiveEx-Onboard] Digital Onboarding (face/ID verification)');
  console.log(`[LiveEx-Onboard] Base URL: ${status.baseUrl}`);
  console.log(
    `[LiveEx-Onboard] Status: ${
      !status.enabled
        ? 'DISABLED'
        : status.configured
          ? 'CONFIGURED — ready'
          : 'NOT CONFIGURED — set LIVEEX_ONBOARD_USERNAME / PASSWORD'
    }`,
  );
}
