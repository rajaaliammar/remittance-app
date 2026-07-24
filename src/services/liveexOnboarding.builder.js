/**
 * Map local Customer + KYC files → LiveEx Digital Onboarding payloads.
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

function lookupId(value, fallback = '') {
  return asString(value, fallback);
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
};

function resolveCountryLookupId(value, fallback = '346') {
  const raw = asString(value);
  if (!raw) return fallback;
  if (/^\d+$/.test(raw)) return raw;
  const key = raw.toLowerCase();
  if (COUNTRY_NAME_TO_ID[key]) return COUNTRY_NAME_TO_ID[key];
  // ISO-2 / ISO-3 style leftovers
  if (COUNTRY_NAME_TO_ID[key.slice(0, 2)]) return COUNTRY_NAME_TO_ID[key.slice(0, 2)];
  return fallback;
}

function resolveNumericLookup(value, fallback) {
  const raw = asString(value);
  if (/^\d+$/.test(raw)) return raw;
  return String(fallback);
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
  const merged = withAmlRowMirror(kyc);
  return merged;
}

export function buildSaveWebsitePayload(customer, { rowIdGid } = {}) {
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
  };
}

function fileNameForSlot(slot, sourceName) {
  const ext = path.extname(sourceName || '') || '.jpg';
  const map = {
    selfie: `selfie${ext}`,
    id_front: `id-front${ext}`,
    id_back: `id-back${ext}`,
    poa: `id-proof${ext}`,
  };
  return map[slot] || `doc${ext}`;
}

const SLOT_TYPE = {
  id_front: 2,
  id_back: 3,
  selfie: 1,
  poa: 4,
};

/**
 * Upload identity images: ID front → ID back → selfie (with livenessPath = front).
 */
export async function uploadIdentityTempDocuments({
  customer,
  rowIdGid,
  email,
  retakeCount = 0,
  idType = 1,
  docTypeName = 'Passport',
  liveexTempDocument,
}) {
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

  const paths = {};
  const responses = {};

  const front = await liveexTempDocument({
    rowIdGid,
    email,
    typeId: SLOT_TYPE.id_front,
    docTypeId: idType,
    docTypeName,
    name: fileNameForSlot('id_front', files.id_front.name),
    base64: files.id_front.base64,
    retakeCount,
  });
  paths.nameFront = front.savedFilePath;
  responses.id_front = front;

  if (files.id_back?.base64) {
    const back = await liveexTempDocument({
      rowIdGid,
      email,
      typeId: SLOT_TYPE.id_back,
      docTypeId: idType,
      docTypeName,
      name: fileNameForSlot('id_back', files.id_back.name),
      base64: files.id_back.base64,
      retakeCount,
    });
    paths.nameBack = back.savedFilePath;
    responses.id_back = back;
  }

  const selfie = await liveexTempDocument({
    rowIdGid,
    email,
    typeId: SLOT_TYPE.selfie,
    docTypeId: idType,
    docTypeName,
    name: fileNameForSlot('selfie', files.selfie.name),
    base64: files.selfie.base64,
    livenessPath: paths.nameFront,
    retakeCount,
  });
  paths.nameSelfie = selfie.savedFilePath;
  responses.selfie = selfie;

  if (files.poa?.base64) {
    const proof = await liveexTempDocument({
      rowIdGid,
      email,
      typeId: SLOT_TYPE.poa,
      docTypeId: idType,
      docTypeName: 'Proof of ID',
      name: fileNameForSlot('poa', files.poa.name),
      base64: files.poa.base64,
      retakeCount,
    });
    paths.nameProof = proof.savedFilePath;
    responses.poa = proof;
  }

  return { paths, responses, filesPresent: Object.keys(files) };
}

export async function buildSubmitKycPayload(customer, { rowIdGid, paths } = {}) {
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

  // LiveEx docs use rowIdGid; their SQL SP binds @ROW_ID_GID — some builds
  // only map `rowId` (same as save-website). Send all aliases.
  // Their SP also requires @confirm / @confirm_2 as strings (bool JSON fails binding).
  return {
    rowIdGid: resolvedRowId,
    rowId: resolvedRowId,
    ROW_ID_GID: resolvedRowId,
    confirm: 'true',
    confirm_2: 'true',
    confirm2: 'true',
    fullName,
    email,
    idType: dig.idType || 1,
    nameSelfie,
    nameFront,
    nameBack,
    qrCodeDetail: '',
  };
}
