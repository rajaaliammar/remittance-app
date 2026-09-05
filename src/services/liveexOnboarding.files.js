/**
 * Collect KYC image files from Customer.kycData for LiveEx temp-document.
 */

import path from 'path';
import {
  readStoredFileBase64,
  resolveLocalPathFromStoredUrl,
} from '../utils/objectStorage.js';
import { pickKycFieldFromCustomer } from '../utils/amlKycData.js';

function flattenEntries(kycData) {
  if (!kycData) return [];
  if (Array.isArray(kycData)) return kycData.filter((e) => e && typeof e === 'object');
  if (typeof kycData === 'object') return [kycData];
  return [];
}

function isUploadUrl(value) {
  const s = String(value || '').trim();
  if (!s || s.startsWith('{')) return false;
  return (
    s.startsWith('/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.includes('/uploads/')
  );
}

/**
 * Portal / static forms use names like "ID Card", "Passport", "Driver License".
 * Upload fields store `{ front, back }` JSON in `value` (same shape for all ID types)
 * with `fileUrl` = front.
 */
function categorizeField(fieldName) {
  const n = String(fieldName || '').toLowerCase().trim();
  if (!n) return null;
  if (
    n.includes('selfie') ||
    n.includes('liveness') ||
    n === 'photo' ||
    n === 'selfie_url'
  ) {
    return 'selfie';
  }
  if (n.includes('proof') || n.includes('address') || n.includes('poa')) {
    return 'poa';
  }
  if (n.includes('back') || n === 'id_document_back_url') return 'id_back';
  if (
    n.includes('front') ||
    n.includes('id_document') ||
    n.includes('passport') ||
    n.includes('license') ||
    n.includes('licence') ||
    n.includes('lisence') ||
    n.includes('driver') ||
    n.includes('id card') ||
    n.includes('national id') ||
    n.includes('state id') ||
    n.includes('state_id') ||
    n.includes('cnic') ||
    n.includes('identity') ||
    n.includes('profile') ||
    n.includes('picture') ||
    (n.includes('id') && (n.includes('card') || n.includes('document')))
  ) {
    return 'id_front';
  }
  return null;
}

function parseFrontBackValue(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(s);
    if (!parsed || typeof parsed !== 'object') return null;
    const front = parsed.front || parsed.id_front || parsed.idFront || null;
    const back = parsed.back || parsed.id_back || parsed.idBack || null;
    if (!front && !back) return null;
    return {
      front: front && isUploadUrl(front) ? String(front).trim() : null,
      back: back && isUploadUrl(back) ? String(back).trim() : null,
    };
  } catch {
    return null;
  }
}

function applyFrontBackUrls(urls, front, back) {
  if (front && isUploadUrl(front) && !urls.id_front) {
    urls.id_front = String(front).trim();
  }
  if (back && isUploadUrl(back) && !urls.id_back) {
    urls.id_back = String(back).trim();
  }
}

function applyPickedUrl(urls, slot, raw) {
  if (!raw) return;
  const pair = parseFrontBackValue(raw);
  if (pair) {
    applyFrontBackUrls(urls, pair.front, pair.back);
    return;
  }
  if (slot && isUploadUrl(raw) && !urls[slot]) {
    urls[slot] = String(raw).trim();
  }
}

function collectUrlCandidates(customer) {
  const urls = {
    id_front: null,
    id_back: null,
    selfie: null,
    poa: null,
  };

  // Enhanced KYC flat keys (may be plain URL or { front, back } JSON)
  applyPickedUrl(
    urls,
    'id_front',
    pickKycFieldFromCustomer(
      customer,
      'id_document_url',
      'id_document_front_url',
      'idFront',
    ),
  );
  applyPickedUrl(
    urls,
    'id_back',
    pickKycFieldFromCustomer(customer, 'id_document_back_url', 'idBack'),
  );
  applyPickedUrl(
    urls,
    'selfie',
    pickKycFieldFromCustomer(customer, 'selfie_url', 'selfie'),
  );
  applyPickedUrl(
    urls,
    'poa',
    pickKycFieldFromCustomer(customer, 'proof_of_address_url', 'poa_url'),
  );

  for (const entry of flattenEntries(customer?.kycData).reverse()) {
    const fields = entry.documents || entry.fields;
    if (!Array.isArray(fields)) continue;

    // Prefer formName / verificationType hints when field names are generic ("profile")
    const formHint = String(
      entry.formName || entry.verificationType || '',
    ).toLowerCase();

    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;

      const pair = parseFrontBackValue(field.value);
      if (pair) {
        applyFrontBackUrls(urls, pair.front, pair.back);
        if (!urls.id_front && isUploadUrl(field.fileUrl)) {
          urls.id_front = String(field.fileUrl).trim();
        }
        continue;
      }

      let slot = categorizeField(field.fieldName || field.name);
      // Static signup forms: "profile picture" / generic upload still count as ID front
      if (
        !slot &&
        (formHint.includes('passport') ||
          formHint.includes('driver') ||
          formHint.includes('license') ||
          formHint.includes('licence') ||
          formHint.includes('lisence') ||
          formHint.includes('state') ||
          formHint.includes('profile') ||
          formHint.includes('id'))
      ) {
        const inputType = String(field.inputType || '').toLowerCase();
        if (
          inputType.includes('upload') ||
          isUploadUrl(field.fileUrl) ||
          isUploadUrl(field.value)
        ) {
          slot = 'id_front';
        }
      }

      const fileUrl = field.fileUrl || field.value || field.url;
      if (slot && isUploadUrl(fileUrl) && !urls[slot]) {
        urls[slot] = String(fileUrl).trim();
      }
    }
  }

  return urls;
}

export async function readStoredFileAsBase64(fileUrl) {
  if (!fileUrl) return null;
  try {
    const b64 = await readStoredFileBase64(fileUrl);
    if (b64) {
      return {
        base64: b64,
        name: path.basename(String(fileUrl).split('?')[0]) || 'document.jpg',
        localPath: resolveLocalPathFromStoredUrl(fileUrl),
      };
    }
  } catch (err) {
    console.warn('[LiveEx-Onboard] Failed reading file', fileUrl, err?.message);
  }
  return null;
}

export async function collectIdentityFilesForOnboarding(customer) {
  const urls = collectUrlCandidates(customer);
  const out = {};
  for (const [slot, url] of Object.entries(urls)) {
    if (!url || !isUploadUrl(url)) continue;
    const file = await readStoredFileAsBase64(url);
    if (file?.base64) out[slot] = { ...file, url };
  }
  return out;
}
