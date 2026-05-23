import fs from 'fs';
import path from 'path';
import { getUploadsBase, getKycUploadDir } from '../utils/uploadPath.js';
import { toAmlDate, resolveAmlClientNumber } from './amlProvider.service.js';

const URL_FIELD_HINTS = [
  'id_document_url',
  'selfie_url',
  'proof_of_address_url',
  'fileUrl',
  'file_url',
  'url',
  'documentUrl',
];

function pickKycField(kyc, ...keys) {
  for (const key of keys) {
    const val = kyc?.[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return null;
}

function mapAmlDocumentType(fieldName) {
  const n = String(fieldName || '').toLowerCase();
  if (n.includes('passport')) return 'Passport';
  if (n.includes('selfie')) return 'Selfie';
  if (n.includes('proof') || n.includes('address') || n.includes('poa')) {
    return 'Proof of Address';
  }
  if (n.includes('back')) return 'ID Card Back';
  if (
    n.includes('front') ||
    n.includes('id_document') ||
    n.includes('license') ||
    n.includes('government')
  ) {
    return 'Passport';
  }
  return 'Government ID';
}

function resolveLocalFilePath(fileUrl) {
  if (!fileUrl) return null;
  let pathname = String(fileUrl).trim();
  try {
    if (pathname.startsWith('http://') || pathname.startsWith('https://')) {
      pathname = new URL(pathname).pathname;
    }
  } catch {
    return null;
  }
  if (!pathname.includes('/uploads/') && !pathname.includes('/kyc/')) {
    return null;
  }

  const rel = pathname.replace(/^\/+/, '').replace(/^uploads\/?/, '');
  const candidates = [
    path.join(getUploadsBase(), rel),
    path.join(getKycUploadDir(), path.basename(pathname)),
    path.join(getUploadsBase(), 'kyc', path.basename(pathname)),
  ];

  for (const full of candidates) {
    if (full && fs.existsSync(full)) return full;
  }
  return null;
}

async function readFileAsBase64(filePath) {
  const buf = await fs.promises.readFile(filePath);
  return buf.toString('base64');
}

async function readUrlAsBase64(fileUrl) {
  const local = resolveLocalFilePath(fileUrl);
  if (local) return readFileAsBase64(local);

  const trimmed = String(fileUrl).trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const res = await fetch(trimmed, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      throw new Error(`Could not download file (${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  }
  return null;
}

/**
 * Collect KYC file references from Customer.kycData (array or object shapes).
 */
export function collectKycFilesForAml(customer) {
  const items = [];
  const seen = new Set();

  const add = (fieldName, fileUrl, meta = {}) => {
    const url = String(fileUrl || '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    items.push({
      fieldName,
      fileUrl: url,
      documentType: mapAmlDocumentType(fieldName),
      ...meta,
    });
  };

  const raw = customer?.kycData;
  const kycObjects = [];
  if (Array.isArray(raw)) {
    kycObjects.push(...raw);
  } else if (raw && typeof raw === 'object') {
    kycObjects.push(raw);
  }

  for (const entry of kycObjects) {
    if (!entry || typeof entry !== 'object') continue;

    for (const key of URL_FIELD_HINTS) {
      if (entry[key] && String(entry[key]).includes('/')) {
        add(key, entry[key]);
      }
    }

    const fields = entry.documents || entry.fields;
    if (Array.isArray(fields)) {
      for (const field of fields) {
        if (!field || typeof field !== 'object') continue;
        const name = field.fieldName || field.name || 'document';
        const url =
          field.fileUrl ||
          (typeof field.value === 'string' &&
          (field.value.startsWith('http') || field.value.includes('/uploads/'))
            ? field.value
            : null);
        if (url) add(name, url);
      }
    }
  }

  return items;
}

/**
 * Build AML POST /api/Customers/documents payload from customer KYC files.
 */
export async function buildAmlDocumentsUploadPayload(customer) {
  const clientNumber = resolveAmlClientNumber(customer);
  const kyc =
    customer.kycData && typeof customer.kycData === 'object' && !Array.isArray(customer.kycData)
      ? customer.kycData
      : {};

  const documentNo =
    pickKycField(kyc, 'passportNumber', 'documentNumber', 'ssn', 'government_id') ||
    clientNumber;

  const today = new Date();
  const issue = new Date(today);
  issue.setFullYear(issue.getFullYear() - 1);
  const expiry = new Date(today);
  expiry.setFullYear(expiry.getFullYear() + 5);

  const issueStr = toAmlDate(issue);
  const expiryStr = toAmlDate(expiry);

  const sources = collectKycFilesForAml(customer);
  const obj_Docs = [];
  const skipped = [];

  for (const src of sources) {
    try {
      const base64 = await readUrlAsBase64(src.fileUrl);
      if (!base64) {
        skipped.push({ ...src, reason: 'File not found on server' });
        continue;
      }
      const fileName = path.basename(
        src.fileUrl.split('?')[0].replace(/\\/g, '/'),
      );
      obj_Docs.push({
        docs_DocumentType: src.documentType,
        docs_DocumentNo: documentNo,
        docs_DocumentIssueDate: issueStr,
        docs_DocumentExpiryDate: expiryStr,
        docs_MasterDetails: `Uploaded from Remittance KYC (${src.fieldName})`,
        docs_Remarks: 'Submitted via Remittance portal',
        docs_Name: fileName || 'document.jpg',
        docs_Base64: base64,
        docs_Filepath: `Uploads/${fileName || 'document.jpg'}`,
      });
    } catch (err) {
      skipped.push({
        ...src,
        reason: err instanceof Error ? err.message : 'Read failed',
      });
    }
  }

  return {
    clientNumber,
    payload: {
      clientNumber,
      obj_Docs,
    },
    obj_Docs,
    skipped,
    sources,
  };
}

export function unwrapAmlDocumentsList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') {
    const o = raw;
    if (Array.isArray(o.customerDocumentsGetList)) {
      return o.customerDocumentsGetList;
    }
    if (Array.isArray(o.documents)) return o.documents;
  }
  return [];
}
