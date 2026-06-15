/**
 * Object storage (Amazon S3) with local disk fallback.
 * Upload → S3 → store public URL in DB. Any API instance can serve metadata; files live in S3.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import {
  getWritableKycUploadDir,
  getWritableAgentKycUploadDir,
  getNotificationUploadDir,
  getCountryServiceUploadDir,
  getUploadsBase,
  getKycUploadDir,
} from './uploadPath.js';

let s3Client = null;

export function isObjectStorageEnabled() {
  return (
    process.env.S3_ENABLED === 'true' &&
    Boolean(process.env.S3_BUCKET?.trim())
  );
}

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
      ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }
  return s3Client;
}

export function getS3PublicBaseUrl() {
  const explicit = process.env.S3_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const bucket = process.env.S3_BUCKET?.trim();
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  return `https://${bucket}.s3.${region}.amazonaws.com`;
}

function getS3KeyPrefix() {
  return (process.env.S3_KEY_PREFIX || 'uploads').replace(/^\/+|\/+$/g, '');
}

export function buildObjectKey(category, filename) {
  const prefix = getS3KeyPrefix();
  return `${prefix}/${category}/${filename}`;
}

export function buildRelativeUploadPath(category, filename) {
  return `/uploads/${category}/${filename}`;
}

export function generateUploadFilename(fieldOrPrefix, originalname, explicitPrefix = '') {
  const ext = path.extname(originalname || '').toLowerCase() || '';
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const base = explicitPrefix || fieldOrPrefix || 'file';
  return `${base}-${uniqueSuffix}${ext}`;
}

function getLocalDirForCategory(category) {
  switch (category) {
    case 'kyc':
      return getWritableKycUploadDir();
    case 'agentKyc':
      return getWritableAgentKycUploadDir();
    case 'notifications':
      return getNotificationUploadDir();
    case 'country-services':
      return getCountryServiceUploadDir();
    case 'cms':
      return path.join(getUploadsBase(), 'cms');
    default:
      return path.join(getUploadsBase(), category);
  }
}

function resolveLocalPathFromStoredUrl(storedUrl) {
  if (!storedUrl) return null;
  let pathname = String(storedUrl).trim();
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
    path.join(getWritableAgentKycUploadDir(), path.basename(pathname)),
  ];

  for (const full of candidates) {
    if (full && fs.existsSync(full)) return full;
  }
  return null;
}

function storedUrlToObjectKey(storedUrl) {
  if (!storedUrl || !isObjectStorageEnabled()) return null;
  const trimmed = String(storedUrl).trim();
  const prefix = getS3KeyPrefix();
  const publicBase = getS3PublicBaseUrl();

  if (trimmed.startsWith(publicBase)) {
    return trimmed.slice(publicBase.length).replace(/^\/+/, '');
  }

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const u = new URL(trimmed);
      const host = u.hostname;
      const bucket = process.env.S3_BUCKET?.trim();
      if (bucket && (host.includes(bucket) || host.startsWith('s3.'))) {
        return u.pathname.replace(/^\/+/, '');
      }
    }
  } catch {
    /* ignore */
  }

  if (trimmed.startsWith('/uploads/')) {
    const rel = trimmed.replace(/^\/uploads\//, '');
    return `${prefix}/${rel}`;
  }

  return null;
}

async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Upload bytes to S3 or local disk. Returns { url, filename, relativePath, key?, localPath? }.
 */
export async function uploadBufferToStorage({
  buffer,
  category,
  filename,
  contentType = 'application/octet-stream',
}) {
  if (!buffer?.length) {
    throw new Error('Empty upload buffer');
  }

  if (isObjectStorageEnabled()) {
    const key = buildObjectKey(category, filename);
    const putParams = {
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    };
    const acl = process.env.S3_ACL?.trim();
    if (acl) putParams.ACL = acl;

    await getS3Client().send(new PutObjectCommand(putParams));
    const url = `${getS3PublicBaseUrl()}/${key}`;
    console.log('[S3] Uploaded', key);
    return {
      url,
      filename,
      key,
      relativePath: buildRelativeUploadPath(category, filename),
    };
  }

  const localDir = getLocalDirForCategory(category);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true, mode: 0o755 });
  }
  const localPath = path.join(localDir, filename);
  await fs.promises.writeFile(localPath, buffer);
  const relativePath = buildRelativeUploadPath(category, filename);
  return { url: relativePath, filename, relativePath, localPath };
}

/** Persist a multer file (memory or disk) to S3 or local storage. */
export async function persistMulterFile(file, category, options = {}) {
  if (!file) return null;

  const filename =
    file.filename ||
    options.filename ||
    generateUploadFilename(
      options.filenamePrefix || file.fieldname,
      file.originalname,
      options.filenamePrefix,
    );

  let buffer = file.buffer;
  if (!buffer && file.path) {
    buffer = await fs.promises.readFile(file.path);
  }
  if (!buffer?.length) {
    throw new Error('Invalid upload file');
  }

  return uploadBufferToStorage({
    buffer,
    category,
    filename,
    contentType: file.mimetype || options.contentType || 'application/octet-stream',
  });
}

/** Save base64 image data (agent onboarding, etc.). */
export async function persistBase64Image(
  base64String,
  category,
  filename,
  contentType = 'image/jpeg',
) {
  if (!base64String) return null;

  const base64Data = base64String.includes(',')
    ? base64String.split(',')[1]
    : base64String;
  const buffer = Buffer.from(base64Data, 'base64');

  return uploadBufferToStorage({
    buffer,
    category,
    filename,
    contentType,
  });
}

/** Normalize stored URL for API responses (https URL or /uploads/ path). */
export function resolvePublicFileUrl(stored) {
  if (!stored) return null;
  const s = String(stored).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith('/') ? s : `/${s}`;
}

/** Read file bytes from S3, local disk, or HTTP URL (for AML sync). */
export async function readStoredFileBuffer(storedUrl) {
  if (!storedUrl) return null;

  const local = resolveLocalPathFromStoredUrl(storedUrl);
  if (local) {
    return fs.promises.readFile(local);
  }

  const key = storedUrlToObjectKey(storedUrl);
  if (key && isObjectStorageEnabled()) {
    const res = await getS3Client().send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
      }),
    );
    return streamToBuffer(res.Body);
  }

  const trimmed = String(storedUrl).trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const res = await fetch(trimmed, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(`Could not download file (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  return null;
}

export async function readStoredFileBase64(storedUrl) {
  const buf = await readStoredFileBuffer(storedUrl);
  return buf ? buf.toString('base64') : null;
}

export function logObjectStorageConfig() {
  if (isObjectStorageEnabled()) {
    console.log(
      `[S3] Object storage enabled | bucket=${process.env.S3_BUCKET} | public=${getS3PublicBaseUrl()}`,
    );
  } else {
    console.log('[S3] Object storage disabled — uploads stored on local disk (set S3_ENABLED=true to use S3)');
  }
}

export { resolveLocalPathFromStoredUrl };
