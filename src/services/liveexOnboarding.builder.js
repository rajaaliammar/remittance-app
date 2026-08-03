/**
 * Map local Customer + KYC files → LiveEx Digital Onboarding payloads.
 *
 * LiveEx submit-kyc uses a legacy ASP.NET binder — field names must match
 * exactly: roW_ID_GID, full_Name, iD_TYPE, namE_Front, namE_Back, namE_Selfie.
 * Clean camelCase names silently bind as empty (no HTTP error).
 */

import path from 'path';
import { toAmlDate } from './amlProvider.service.js';
import { pickKycFieldFromCustomer } from '../utils/amlKycData.js';
import { collectIdentityFilesForOnboarding } from './liveexOnboarding.files.js';

function asString(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function digitsOnly(value) {
  return asString(value).replace(/\D/g, '');
}

/** When app stores country name/ISO instead of LiveEx lookup id. */
const COUNTRY_NAME_TO_ID = {
  ethiopia: '346',
  et: '346',
  eth: '346',
  canada: '307',
  ca: '307',
  'united states': '308',
  'united states of america': '308',
  usa: '308',
  us: '308',
  pakistan: '364',
  pk: '364',
};

/** LiveEx temp-document / submit-kyc docTypeId values (docs). */
export const LIVEEX_DOC_TYPE = {
  CITIZENSHIP_CARD: 4,
  PASSPORT: 5,
  DRIVERS_LICENCE: 7,
};

/**
 * Map app / KYC id labels → LiveEx docTypeId + display name.
 * Invalid ids (e.g. 1) break portal document slots and OCR.
 */
export function resolveLiveexDocType(rawIdType, rawDocTypeName) {
  const nameHint = asString(rawDocTypeName).toLowerCase();
  const idHint = asString(rawIdType).toLowerCase();
  const combined = `${idHint} ${nameHint}`.trim();

  const asNum = Number(rawIdType);
  if (
    asNum === LIVEEX_DOC_TYPE.CITIZENSHIP_CARD ||
    asNum === LIVEEX_DOC_TYPE.PASSPORT ||
    asNum === LIVEEX_DOC_TYPE.DRIVERS_LICENCE
  ) {
    const byId = {
      [LIVEEX_DOC_TYPE.CITIZENSHIP_CARD]: {
        docTypeId: LIVEEX_DOC_TYPE.CITIZENSHIP_CARD,
        docTypeName: 'Citizenship Card',
        requiresBack: true,
      },
      [LIVEEX_DOC_TYPE.PASSPORT]: {
        docTypeId: LIVEEX_DOC_TYPE.PASSPORT,
        docTypeName: 'Passport',
        requiresBack: false,
      },
      [LIVEEX_DOC_TYPE.DRIVERS_LICENCE]: {
        docTypeId: LIVEEX_DOC_TYPE.DRIVERS_LICENCE,
        docTypeName: 'Drivers Licence',
        requiresBack: true,
      },
    };
    return byId[asNum];
  }

  if (
    /driver|licence|license/.test(combined) ||
    idHint === 'license' ||
    idHint === 'licence'
  ) {
    return {
      docTypeId: LIVEEX_DOC_TYPE.DRIVERS_LICENCE,
      docTypeName: 'Drivers Licence',
      requiresBack: true,
    };
  }

  if (
    /passport/.test(combined) ||
    idHint === 'passport'
  ) {
    return {
      docTypeId: LIVEEX_DOC_TYPE.PASSPORT,
      docTypeName: 'Passport',
      requiresBack: false,
    };
  }

  if (
    /citizen|national|state|cnic|identity|id card|national_id|state_id/.test(
      combined,
    ) ||
    idHint === 'state' ||
    idHint === 'national_id'
  ) {
    return {
      docTypeId: LIVEEX_DOC_TYPE.CITIZENSHIP_CARD,
      docTypeName: 'Citizenship Card',
      requiresBack: true,
    };
  }

  // Safe default — Passport (never use 1)
  return {
    docTypeId: LIVEEX_DOC_TYPE.PASSPORT,
    docTypeName: asString(rawDocTypeName, 'Passport'),
    requiresBack: false,
  };
}

function resolveCountryLookupId(value, fallback = '346') {
  const raw = asString(value);
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return raw;
  const key = raw.toLowerCase();
  if (COUNTRY_NAME_TO_ID[key]) return COUNTRY_NAME_TO_ID[key];
  if (COUNTRY_NAME_TO_ID[key.slice(0, 2)]) return COUNTRY_NAME_TO_ID[key.slice(0, 2)];
  return fallback;
}

function resolveNumericLookup(value, fallback) {
  const raw = asString(value);
  if (/^\d+$/.test(raw)) return raw;
  return String(fallback);
}

function buildSendUrl(rowId) {
  const base = (
    process.env.LIVEEX_SEND_URL_BASE ||
    process.env.MOBILE_APP_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
  return `${base}/register?resumeStep=9&rowId=${encodeURIComponent(rowId)}`;
}

export function extractDigitalOnboarding(customer) {
  const raw = customer?.kycData;
  const entries = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? [raw]
      : [];

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const dig = entries[i]?.digitalOnboarding;
    if (dig && typeof dig === 'object') return dig;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.digitalOnboarding) {
    return raw.digitalOnboarding;
  }
  return null;
}

export function mergeDigitalOnboarding(customer, patch) {
  const syncedAt = new Date().toISOString();
  const nextPatch = { ...patch, syncedAt };
  const raw = customer.kycData;

  const withAmlRowMirror = (entry) => {
    const digitalOnboarding = {
      ...(entry.digitalOnboarding || {}),
      ...nextPatch,
    };
    const aml = { ...(entry.aml || {}) };
    const mapped = { ...(aml.mapped || {}) };
    if (digitalOnboarding.rowIdGid) {
      mapped.rowIdGid = digitalOnboarding.rowIdGid;
      aml.mapped = mapped;
      aml.rowIdGid = digitalOnboarding.rowIdGid;
    }
    if (digitalOnboarding.clientNumber) {
      mapped.clientNumber = digitalOnboarding.clientNumber;
      aml.mapped = mapped;
      aml.clientNumber = digitalOnboarding.clientNumber;
    }
    return {
      ...entry,
      digitalOnboarding,
      aml,
      ...(digitalOnboarding.clientNumber
        ? { amlClientNumber: digitalOnboarding.clientNumber }
        : {}),
    };
  };

  if (Array.isArray(raw)) {
    const next = raw.map((entry) => ({ ...entry }));
    const idx = next.length > 0 ? next.length - 1 : -1;
    if (idx >= 0) {
      next[idx] = withAmlRowMirror(next[idx]);
    } else {
      next.push(
        withAmlRowMirror({
          id: `liveex_onboard_${Date.now()}`,
          verificationType: 'LiveEx Digital Onboarding',
        }),
      );
    }
    return next;
  }

  const kyc =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  return withAmlRowMirror(kyc);
}

export function buildSaveWebsitePayload(customer, { rowIdGid, sendUrl } = {}) {
  const rowId =
    asString(rowIdGid) || asString(extractDigitalOnboarding(customer)?.rowIdGid);
  if (!rowId) {
    const err = new Error('LiveEx rowIdGid is required — verify email OTP first');
    err.status = 400;
    err.code = 'LIVEEX_ROW_ID_REQUIRED';
    throw err;
  }

  const email = asString(customer.email);
  const phone = digitsOnly(customer.phone || customer.telephone).slice(-15);
  const dobRaw = customer.dateOfBirth;
  const dateOfBirth = dobRaw
    ? /^\d{2}\/\d{2}\/\d{4}$/.test(String(dobRaw))
      ? String(dobRaw)
      : toAmlDate(dobRaw)
    : '';

  const country = resolveCountryLookupId(
    pickKycFieldFromCustomer(customer, 'liveex_country_id', 'country_id') ||
      customer.country ||
      customer.residentCountry ||
      customer.nationality,
    '346',
  );
  const nationality = resolveCountryLookupId(
    pickKycFieldFromCustomer(customer, 'liveex_nationality_id', 'nationality_id') ||
      customer.nationality ||
      country,
    country,
  );

  const jobTitle = resolveNumericLookup(
    pickKycFieldFromCustomer(customer, 'job_title', 'jobTitle', 'liveex_job_title_id') ||
      customer.occupation,
    '454', // Others
  );

  const sourceOfIncome = resolveNumericLookup(
    pickKycFieldFromCustomer(
      customer,
      'source_of_fund',
      'sourceOfFund',
      'liveex_source_of_fund_id',
    ) || customer.sourceOfFund,
    '1', // Salary
  );

  const purposeOfTransaction = resolveNumericLookup(
    pickKycFieldFromCustomer(customer, 'purpose_of_transaction', 'purpose') || '1',
    '1',
  );

  const employerName =
    pickKycFieldFromCustomer(customer, 'employer', 'employerName') ||
    customer.occupation ||
    'Self Employed';

  return {
    rowId,
    firstName: asString(customer.firstName, 'Unknown'),
    lastName: asString(customer.lastName, 'Unknown'),
    dateOfBirth,
    email,
    phone: phone || '0000000000',
    homeAddress: asString(customer.address, 'Not Provided'),
    city: asString(customer.city, 'Unknown'),
    province: asString(customer.region, 'NA'),
    postalCode: asString(customer.zipCode, '00000'),
    country: asString(country, '346'),
    nationality: asString(nationality, '346'),
    jobTitle: asString(jobTitle, '454'),
    employerName: asString(employerName, 'Self Employed'),
    sourceOfIncome: asString(sourceOfIncome, '1'),
    purposeOfTransaction: asString(purposeOfTransaction, '1'),
    unitApt: asString(customer.unitApt),
    middleName: asString(customer.middleName),
    gender: asString(customer.gender),
    residentCountry: asString(country, '346'),
    // Required by LiveEx for "Re-request" emails after unreadable / mismatched ID
    sendUrl: asString(sendUrl, buildSendUrl(rowId)),
  };
}

/** LiveEx only allows .jpg / .jpeg / .png (checked via name extension). */
function fileNameForSlot(slot, sourceName) {
  const rawExt = path.extname(sourceName || '').toLowerCase();
  const ext = ['.jpg', '.jpeg', '.png'].includes(rawExt) ? rawExt : '.jpg';
  const map = {
    selfie: `selfie${ext}`,
    id_front: `id-front${ext}`,
    id_back: `id-back${ext}`,
  };
  return map[slot] || `doc${ext}`;
}

const SLOT_TYPE = {
  id_front: 2,
  id_back: 3,
  selfie: 1,
};

function assertSavedPath(response, slot) {
  const saved = asString(response?.savedFilePath);
  if (!saved) {
    const err = new Error(
      `LiveEx temp-document did not return savedFilePath for ${slot}`,
    );
    err.status = 502;
    err.code = 'LIVEEX_TEMP_PATH_MISSING';
    err.data = response;
    throw err;
  }
  return saved;
}

/**
 * Resolve LiveEx doc type from request options + customer KYC.
 */
export function resolveDocTypeFromCustomer(customer, options = {}) {
  const dig = extractDigitalOnboarding(customer) || {};
  const fromKyc =
    pickKycFieldFromCustomer(customer, 'id_type', 'idType', 'document_type') ||
    null;
  return resolveLiveexDocType(
    options.idType ?? dig.idType ?? fromKyc,
    options.docTypeName ?? dig.docTypeName ?? fromKyc,
  );
}

/**
 * Upload identity images via /api/customer/temp-document only:
 * ID front → ID back (when required/present) → selfie (livenessPath = front path).
 * Do NOT use this for proof-of-address — that belongs on /api/customer/documents.
 */
export async function uploadIdentityTempDocuments({
  customer,
  rowIdGid,
  email,
  retakeCount = 0,
  idType,
  docTypeName,
  requireBack,
  liveexTempDocument,
}) {
  const resolved = resolveLiveexDocType(idType, docTypeName);
  const docTypeId = resolved.docTypeId;
  const label = resolved.docTypeName;
  const backRequired =
    requireBack != null ? Boolean(requireBack) : resolved.requiresBack;

  const files = await collectIdentityFilesForOnboarding(customer);
  if (!files.id_front?.base64) {
    const err = new Error(
      'ID front image is required for LiveEx face/ID verification',
    );
    err.status = 400;
    err.code = 'LIVEEX_ID_FRONT_REQUIRED';
    throw err;
  }
  if (!files.selfie?.base64) {
    const err = new Error('Selfie is required for LiveEx face/ID verification');
    err.status = 400;
    err.code = 'LIVEEX_SELFIE_REQUIRED';
    throw err;
  }
  if (backRequired && !files.id_back?.base64) {
    const err = new Error(
      `ID back image is required for ${label}. Upload front and back, then retry.`,
    );
    err.status = 400;
    err.code = 'LIVEEX_ID_BACK_REQUIRED';
    throw err;
  }

  const paths = {};
  const responses = {};

  const front = await liveexTempDocument({
    rowIdGid,
    email,
    typeId: SLOT_TYPE.id_front,
    docTypeId,
    docTypeName: label,
    name: fileNameForSlot('id_front', files.id_front.name),
    base64: files.id_front.base64,
    retakeCount,
  });
  paths.nameFront = assertSavedPath(front, 'id_front');
  responses.id_front = front;

  if (files.id_back?.base64) {
    const back = await liveexTempDocument({
      rowIdGid,
      email,
      typeId: SLOT_TYPE.id_back,
      docTypeId,
      docTypeName: label,
      name: fileNameForSlot('id_back', files.id_back.name),
      base64: files.id_back.base64,
      retakeCount,
    });
    paths.nameBack = assertSavedPath(back, 'id_back');
    responses.id_back = back;
  }

  const selfie = await liveexTempDocument({
    rowIdGid,
    email,
    typeId: SLOT_TYPE.selfie,
    docTypeId,
    docTypeName: label,
    name: fileNameForSlot('selfie', files.selfie.name),
    base64: files.selfie.base64,
    // Opaque path from ID-front response — required for face match / liveness
    livenessPath: paths.nameFront,
    retakeCount,
  });
  paths.nameSelfie = assertSavedPath(selfie, 'selfie');
  responses.selfie = selfie;

  return {
    paths,
    responses,
    filesPresent: Object.keys(files),
    docTypeId,
    docTypeName: label,
  };
}

/**
 * Build submit-kyc body with LiveEx legacy binder keys.
 * Also includes a few aliases for older builds that still read camelCase.
 */
export async function buildSubmitKycPayload(customer, { rowIdGid, paths, idType } = {}) {
  const dig = extractDigitalOnboarding(customer) || {};
  const email = asString(customer.email);
  const fullName =
    [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() ||
    'Unknown';

  const nameFront = paths?.nameFront || dig.paths?.nameFront;
  const nameSelfie = paths?.nameSelfie || dig.paths?.nameSelfie;
  const nameBack = paths?.nameBack || dig.paths?.nameBack || '';

  if (!nameFront || !nameSelfie) {
    const err = new Error(
      'LiveEx identity file paths missing — upload ID front and selfie first',
    );
    err.status = 400;
    err.code = 'LIVEEX_PATHS_REQUIRED';
    throw err;
  }

  const resolvedRowId = asString(rowIdGid || dig.rowIdGid);
  if (!resolvedRowId) {
    const err = new Error('LiveEx rowIdGid is required for submit-kyc');
    err.status = 400;
    err.code = 'LIVEEX_ROW_ID_REQUIRED';
    throw err;
  }

  const resolved = resolveLiveexDocType(
    idType ?? dig.idType,
    dig.docTypeName,
  );

  // Exact casing from LiveEx Digital Onboarding API docs (silent-fail binder).
  return {
    roW_ID_GID: resolvedRowId,
    full_Name: fullName,
    email,
    iD_TYPE: resolved.docTypeId,
    namE_Selfie: nameSelfie,
    namE_Front: nameFront,
    namE_Back: nameBack,
    qrCodeDetail: '',
    // Aliases for older / alternate binders (harmless extras)
    rowIdGid: resolvedRowId,
    rowId: resolvedRowId,
    ROW_ID_GID: resolvedRowId,
    confirm: 'true',
    confirm_2: 'true',
    confirm2: 'true',
  };
}
