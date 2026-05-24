import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUploadsBase, getKycUploadDir } from '../utils/uploadPath.js';
import { resolveAmlClientNumber } from './amlProvider.service.js';
import {
  extractAmlCacheFromKycData,
  pickKycFieldFromCustomer,
} from '../utils/amlKycData.js';

const URL_FIELD_HINTS = [
  'id_document_url',
  'id_document_back_url',
  'selfie_url',
  'proof_of_address_url',
  'fileUrl',
  'file_url',
  'url',
  'documentUrl',
];

/**
 * POST /api/Customers/documents expects string labels (see AML API docs), e.g. "Passport".
 * Dates must be yyyy-MM-dd (e.g. "2024-01-15"), not dd/MM/yyyy.
 */
const AML_DOC_TYPE_LABEL = {
  id_front: 'Passport',
  id_back: 'Government ID',
  selfie: 'Other',
  poa: 'Proof of Address',
  default: 'Government ID',
};

const CANONICAL_UPLOAD_ORDER = [
  'id_document_url',
  'id_document_back_url',
  'selfie_url',
  'proof_of_address_url',
];

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
  return 'default';
}

function mapAmlDocumentTypeLabel(fieldName) {
  const cat = categorizeField(fieldName);
  return AML_DOC_TYPE_LABEL[cat] || AML_DOC_TYPE_LABEL.default;
}

/** ISO date yyyy-MM-dd for Customer Doc Upload API */
export function toAmlDocumentDateIso(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '2020-01-01';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

  const projectRoot = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const projectKyc = path.join(projectRoot, 'uploads', 'kyc');
  const base = path.basename(pathname);
  for (const dir of [projectKyc, getKycUploadDir()]) {
    const alt = path.join(dir, base);
    if (fs.existsSync(alt)) return alt;
  }

  return null;
}

/** Find file on disk when KYC URL metadata is stale but upload timestamp matches AML doc_name. */
function findKycFileByMatchToken(matchToken) {
  if (!matchToken || matchToken.length < 10) return null;
  const dirs = new Set([getKycUploadDir(), path.join(getUploadsBase(), 'kyc')]);
  const projectRoot = path.resolve(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
  );
  dirs.add(path.join(projectRoot, 'uploads', 'kyc'));

  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const prefix = matchToken.slice(0, 10);
    const hit = names.find(
      (name) =>
        name.includes(matchToken) ||
        (prefix.length >= 10 && name.includes(`document-${prefix}`)),
    );
    if (hit) {
      const full = path.join(dir, hit);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

async function readFileAsBase64(filePath) {
  const buf = await fs.promises.readFile(filePath);
  return buf.toString('base64');
}

/** AML stores Windows paths; local portal saves under /uploads/kyc/document-{ts}-…. */
function basenameFromAnyPath(value) {
  return path
    .basename(String(value || '').split('?')[0].replace(/\\/g, '/'))
    .trim();
}

/** Shared upload timestamp between AML doc_name and local KYC filename. */
export function extractAmlDocumentMatchToken(docName, filepath) {
  const combined = `${docName || ''} ${filepath || ''}`;
  const docMatch = combined.match(/document(\d{10,})/i);
  if (docMatch?.[1]) return docMatch[1].slice(0, 13);

  const runs = combined.match(/\d{10,}/g) || [];
  for (const run of runs) {
    if (run.length >= 10) return run.slice(0, 13);
  }
  return '';
}

/** e.g. "Passport copy … (Government ID (front))" → Government ID (front) */
export function inferKycFieldFromAmlDoc(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const details = String(
    doc.doc_MASTER_DETAILS ??
      doc.docs_Remarks ??
      doc.remarks ??
      '',
  );
  const openIdx = details.lastIndexOf('(');
  const closeIdx = details.lastIndexOf(')');
  if (openIdx >= 0 && closeIdx > openIdx) {
    const inner = details.slice(openIdx + 1, closeIdx).trim();
    if (inner) return inner;
  }

  const type = String(doc.doccument_type ?? doc.docs_DocumentType ?? '').toLowerCase();
  if (type.includes('passport')) return 'Government ID (front)';
  if (type.includes('government')) return 'Government ID (back)';
  return '';
}

function localUrlMatchesAmlDocument(src, docName, filepath, matchToken) {
  const base = basenameFromAnyPath(src.fileUrl);
  if (!base) return false;

  const target = basenameFromAnyPath(filepath || docName);
  if (target && (base === target || base.toLowerCase() === target.toLowerCase())) {
    return true;
  }

  if (matchToken && matchToken.length >= 10 && base.includes(matchToken)) {
    return true;
  }

  const localRun = base.match(/document-?(\d{10,})/i)?.[1];
  if (matchToken && localRun && localRun.startsWith(matchToken.slice(0, 10))) {
    return true;
  }

  return false;
}

/** Resolve on-disk KYC file for an AML document row (by filename / filepath / upload token). */
export function findLocalFileForAmlDocument(customer, docName, filepath, amlDocRecord = null) {
  const target = basenameFromAnyPath(filepath || docName);
  const matchToken = extractAmlDocumentMatchToken(docName, filepath);
  const sources = collectKycFilesForAml(customer);

  const kycFieldHint = inferKycFieldFromAmlDoc(amlDocRecord);
  if (kycFieldHint) {
    const byField = sources.find(
      (src) =>
        String(src.fieldName || '').toLowerCase() === kycFieldHint.toLowerCase(),
    );
    if (byField) {
      const local = resolveLocalFilePath(byField.fileUrl);
      if (local) return local;
    }
  }

  for (const src of sources) {
    if (localUrlMatchesAmlDocument(src, docName, filepath, matchToken)) {
      const local = resolveLocalFilePath(src.fileUrl);
      if (local) return local;
    }
  }

  if (target) {
    const direct =
      resolveLocalFilePath(`/uploads/kyc/${target}`) ||
      resolveLocalFilePath(`/uploads/${target}`);
    if (direct) return direct;
  }

  if (matchToken) {
    return findKycFileByMatchToken(matchToken);
  }

  return null;
}

/** Find portal customer linked to an AML client number (CS_…). */
export async function findCustomerByAmlClientNumber(clientNumber, prisma) {
  const cn = String(clientNumber || '').trim();
  if (!cn) return null;

  const pattern = `%${cn}%`;
  const rows = await prisma.$queryRaw`
    SELECT id, email, "firstName", "lastName", "kycData"
    FROM customers
    WHERE "kycData"::text LIKE ${pattern}
    ORDER BY "updatedAt" DESC NULLS LAST
    LIMIT 15
  `;

  for (const row of rows) {
    const customer = {
      id: row.id,
      kycData: row.kycData,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
    };
    const cache = extractAmlCacheFromKycData(customer.kycData);
    const linked =
      cache?.clientNumber ||
      resolveAmlClientNumber(customer);
    if (String(linked).trim() === cn) return customer;
  }
  return null;
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

/** @deprecated Customer save uses dd/MM/yyyy; document upload uses ISO — see toAmlDocumentDateIso */
export function toAmlDocumentDate(input) {
  return toAmlDocumentDateIso(input);
}

/** Document number must be numeric-friendly for AML (avoid CS_ client ids). */
export function resolveAmlDocumentNumber(customer, clientNumber) {
  const fromKyc = pickKycFieldFromCustomer(
    customer,
    'passportNumber',
    'documentNumber',
    'government_id',
    'ssn',
    'cnic',
  );
  if (fromKyc) {
    const alnum = fromKyc.replace(/[^a-zA-Z0-9]/g, '').slice(0, 25);
    if (alnum.length >= 4) return alnum;
  }

  const idSuffix = String(customer?.id || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-9);
  if (idSuffix.length >= 6) return `P${idSuffix}`;

  return 'P100000001';
}

/**
 * Collect KYC file references from Customer.kycData (array or object shapes).
 * Dedupes URLs and prefers canonical registration fields (max 4 docs).
 */
export function collectKycFilesForAml(customer) {
  const items = [];
  const seen = new Set();

  const add = (fieldName, fileUrl) => {
    const url = String(fileUrl || '').trim();
    if (!url || seen.has(url)) return;
    if (!url.includes('/')) return;
    seen.add(url);
    items.push({
      fieldName,
      fileUrl: url,
      documentType: mapAmlDocumentTypeLabel(fieldName),
      category: categorizeField(fieldName),
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

  const byField = new Map(items.map((i) => [i.fieldName, i]));
  const prioritized = [];

  for (const fieldName of CANONICAL_UPLOAD_ORDER) {
    const hit = byField.get(fieldName);
    if (hit) prioritized.push(hit);
  }

  const used = new Set(prioritized.map((p) => p.fileUrl));
  for (const item of items) {
    if (!used.has(item.fileUrl)) {
      prioritized.push(item);
      used.add(item.fileUrl);
    }
  }

  const byCategory = new Map();
  const canonical = [];
  for (const item of prioritized) {
    const cat = item.category || 'default';
    if (!byCategory.has(cat)) {
      byCategory.set(cat, item);
      canonical.push(item);
    }
  }

  return canonical;
}

export function isAmlProviderErrorResponse(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.isError) return true;
  const msg = String(raw.message || raw.messageDetails || raw.title || '');
  return /error|failed|invalid|exception/i.test(msg);
}

/**
 * Build AML POST /api/Customers/documents payload from customer KYC files.
 */
export async function buildAmlDocumentsUploadPayload(customer) {
  const clientNumber = resolveAmlClientNumber(customer);
  const documentNo = resolveAmlDocumentNumber(customer, clientNumber);

  const today = new Date();
  const issue = new Date(today);
  issue.setFullYear(issue.getFullYear() - 1);
  const expiry = new Date(today);
  expiry.setFullYear(expiry.getFullYear() + 5);

  const issueStr = toAmlDocumentDateIso(issue);
  const expiryStr = toAmlDocumentDateIso(expiry);

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
        docs_MasterDetails: `Passport copy uploaded for verification (${src.fieldName})`,
        docs_Remarks: 'Submitted via OneZaPay registration',
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
    documentNo,
    issueStr,
    expiryStr,
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
