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

function categorizeField(fieldName) {
  const n = String(fieldName || '').toLowerCase();
  if (n.includes('selfie')) return 'selfie';
  if (n.includes('proof') || n.includes('address') || n.includes('poa')) return 'poa';
  if (n.includes('back')) return 'id_back';
  if (
    n.includes('front') ||
    n.includes('id_document') ||
    n.includes('passport') ||
    n.includes('license')
  ) {
    return 'id_front';
  }
  return null;
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
      const slot = categorizeField(field.fieldName || field.name);
      const fileUrl = field.fileUrl || field.value || field.url;
      if (slot && fileUrl && !urls[slot]) urls[slot] = String(fileUrl);
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
    if (!url) continue;
    const file = await readStoredFileAsBase64(url);
    if (file?.base64) out[slot] = { ...file, url };
  }
  return out;
}
