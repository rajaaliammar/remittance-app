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
 * Portal forms often use names like "ID Card" / "Driver License" (not id_document_url).
 * Upload-2 fields store `{ front, back }` JSON in `value` with `fileUrl` = front.
 */
function categorizeField(fieldName) {
  const n = String(fieldName || '').toLowerCase().trim();
  if (!n) return null;
  if (n.includes('selfie') || n.includes('liveness') || n === 'photo') {
    return 'selfie';
  }
  if (n.includes('proof') || n.includes('address') || n.includes('poa')) {
    return 'poa';
  }
  if (n.includes('back')) return 'id_back';
  if (
    n.includes('front') ||
    n.includes('id_document') ||
    n.includes('passport') ||
    n.includes('license') ||
    n.includes('driver') ||
    n.includes('id card') ||
    n.includes('national id') ||
    n.includes('state id') ||
    n.includes('cnic') ||
    n.includes('identity') ||
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

function collectUrlCandidates(customer) {
  const urls = {
    id_front:
      pickKycFieldFromCustomer(
        customer,
        'id_document_url',
        'id_document_front_url',
        'idFront',
      ) || null,
    id_back:
      pickKycFieldFromCustomer(customer, 'id_document_back_url', 'idBack') ||
      null,
    selfie: pickKycFieldFromCustomer(customer, 'selfie_url', 'selfie') || null,
    poa:
      pickKycFieldFromCustomer(customer, 'proof_of_address_url', 'poa_url') ||
      null,
  };

  for (const entry of flattenEntries(customer?.kycData)) {
    const fields = entry.documents || entry.fields;
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;

      const pair = parseFrontBackValue(field.value);
      if (pair) {
        if (pair.front && !urls.id_front) urls.id_front = pair.front;
        if (pair.back && !urls.id_back) urls.id_back = pair.back;
        // fileUrl is usually the front copy for Upload-2 fields
        if (!urls.id_front && isUploadUrl(field.fileUrl)) {
          urls.id_front = String(field.fileUrl).trim();
        }
        continue;
      }

      const slot = categorizeField(field.fieldName || field.name);
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
