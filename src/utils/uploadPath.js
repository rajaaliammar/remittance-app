import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always use absolute paths – never pass relative paths to fs or multer
const projectRoot = path.resolve(path.join(__dirname, '..', '..'));
const projectKycDir = path.resolve(projectRoot, 'uploads', 'kyc');
const tmpdirKycDir = path.resolve(os.tmpdir(), 'remittance-kyc-uploads', 'kyc');
const projectAgentKycDir = path.resolve(projectRoot, 'uploads', 'agentKyc');
const tmpdirAgentKycDir = path.resolve(os.tmpdir(), 'remittance-kyc-uploads', 'agentKyc');

let resolvedKycDir = null;
let resolvedUploadsBase = null;

/**
 * Create directory if missing; verify writable. Uses absolute path only.
 * @returns {string|null} Absolute path if writable, null otherwise
 */
function ensureWritableDir(absDir) {
  if (!absDir) return null;
  // Force absolute path
  const resolvedDir = path.resolve(absDir);
  try {
    if (!fs.existsSync(resolvedDir)) {
      console.log('[Upload] Creating directory:', resolvedDir);
      fs.mkdirSync(resolvedDir, { recursive: true, mode: 0o755 });
    }
    fs.accessSync(resolvedDir, fs.constants.W_OK);
    return resolvedDir;
  } catch (err) {
    console.warn(`[Upload] ensureWritableDir failed for ${resolvedDir}:`, err.message);
    return null;
  }
}

/**
 * Resolve KYC upload dir: prefer env, then tmpdir (avoids EACCES on project), then project.
 * Order chosen so we rarely depend on project uploads/ being writable.
 */
function resolveUploadDirs() {
  if (resolvedKycDir) return { kycDir: resolvedKycDir, uploadsBase: resolvedUploadsBase };

  // 1) Explicit env (absolute path)
  if (process.env.KYC_UPLOAD_DIR) {
    const kycDir = path.resolve(process.env.KYC_UPLOAD_DIR);
    if (ensureWritableDir(kycDir)) {
      resolvedKycDir = kycDir;
      resolvedUploadsBase = path.dirname(kycDir);
      console.log('[Upload] KYC dir (from KYC_UPLOAD_DIR):', resolvedKycDir);
      return { kycDir: resolvedKycDir, uploadsBase: resolvedUploadsBase };
    }
  }

  // 2) Tmpdir first – avoids "EACCES: permission denied, mkdir 'uploads/kyc'" on strict envs
  if (ensureWritableDir(tmpdirKycDir)) {
    resolvedKycDir = tmpdirKycDir;
    resolvedUploadsBase = path.join(os.tmpdir(), 'remittance-kyc-uploads');
    console.log('[Upload] KYC dir (tmpdir):', resolvedKycDir);
    return { kycDir: resolvedKycDir, uploadsBase: resolvedUploadsBase };
  }

  // 3) Project uploads/kyc
  if (ensureWritableDir(projectKycDir)) {
    resolvedKycDir = projectKycDir;
    resolvedUploadsBase = path.join(projectRoot, 'uploads');
    console.log('[Upload] KYC dir (project):', resolvedKycDir);
    return { kycDir: resolvedKycDir, uploadsBase: resolvedUploadsBase };
  }

  // Last resort: use tmpdir even if ensure failed (e.g. race); mkdir in getWritableKycUploadDir will retry
  console.warn('[Upload] Using tmpdir fallback for KYC:', tmpdirKycDir);
  try {
    fs.mkdirSync(tmpdirKycDir, { recursive: true, mode: 0o755 });
  } catch (_) { }
  resolvedKycDir = tmpdirKycDir;
  resolvedUploadsBase = path.join(os.tmpdir(), 'remittance-kyc-uploads');
  return { kycDir: resolvedKycDir, uploadsBase: resolvedUploadsBase };
}

resolveUploadDirs();

export function getKycUploadDir() {
  if (!resolvedKycDir) resolveUploadDirs();
  return resolvedKycDir || tmpdirKycDir;
}

/**
 * Returns a KYC upload directory that is guaranteed writable (absolute path).
 * Never throws for permission errors – always falls back to tmpdir so multer never sees EACCES.
 */
export function getWritableKycUploadDir() {
  let current = getKycUploadDir();

  // CRITICAL FIX: Ensure path is absolute before using fs methods
  if (!path.isAbsolute(current)) {
    console.warn('[Upload] Warning: getKycUploadDir returned relative path:', current);
    current = path.resolve(process.cwd(), current);
    console.log('[Upload] Resolved to absolute:', current);
  }

  try {
    if (!fs.existsSync(current)) {
      console.log('[Upload] Creating KYC dir:', current);
      fs.mkdirSync(current, { recursive: true, mode: 0o755 });
    }
    fs.accessSync(current, fs.constants.W_OK);
    return current;
  } catch (err) {
    console.error(`[Upload] Failed to access/create ${current}:`, err.message);

    // Switch to tmpdir and retry; never throw so client never sees EACCES
    try {
      if (!fs.existsSync(tmpdirKycDir)) {
        fs.mkdirSync(tmpdirKycDir, { recursive: true, mode: 0o755 });
      }
      fs.accessSync(tmpdirKycDir, fs.constants.W_OK);
    } catch (_) {
      try {
        fs.mkdirSync(tmpdirKycDir, { recursive: true, mode: 0o777 });
      } catch (__) { }
    }
    resolvedKycDir = tmpdirKycDir;
    resolvedUploadsBase = path.join(os.tmpdir(), 'remittance-kyc-uploads');
    console.warn('[Upload] Using tmpdir fallback for KYC:', tmpdirKycDir);
    return tmpdirKycDir;
  }
}

export function getUploadsBase() {
  if (!resolvedUploadsBase) resolveUploadDirs();
  return resolvedUploadsBase || path.join(os.tmpdir(), 'remittance-kyc-uploads');
}

/** Directory for notification images (admin uploads from portal). Served at /uploads/notifications/ */
export function getNotificationUploadDir() {
  const base = getUploadsBase();
  const dir = path.join(base, 'notifications');
  if (!ensureWritableDir(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    } catch (_) {}
  }
  return path.resolve(dir);
}

/** Country service display images (portal). Served at /uploads/country-services/ */
export function getCountryServiceUploadDir() {
  const base = getUploadsBase();
  const dir = path.join(base, 'country-services');
  if (!ensureWritableDir(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    } catch (_) {}
  }
  return path.resolve(dir);
}

/**
 * Returns agent KYC upload directory (absolute path).
 * Always uses project folder to ensure files are accessible via static serving.
 * Unlike customer KYC, agentKyc should always be in the project folder.
 */
export function getAgentKycUploadDir() {
  // 1) Explicit env (absolute path)
  if (process.env.AGENT_KYC_UPLOAD_DIR) {
    const agentKycDir = path.resolve(process.env.AGENT_KYC_UPLOAD_DIR);
    if (ensureWritableDir(agentKycDir)) {
      return agentKycDir;
    }
  }

  // 2) Always use project uploads/agentKyc (required for static file serving)
  // Try to create it if it doesn't exist
  try {
    if (!fs.existsSync(projectAgentKycDir)) {
      fs.mkdirSync(projectAgentKycDir, { recursive: true, mode: 0o755 });
    }
    if (ensureWritableDir(projectAgentKycDir)) {
      return projectAgentKycDir;
    }
  } catch (err) {
    console.error('[Upload] Failed to create/access project agentKyc dir:', err.message);
  }

  // If project folder fails, try tmpdir as last resort (but log warning)
  console.warn('[Upload] WARNING: Project agentKyc folder not writable, using tmpdir. Files may not be accessible via static serving.');
  try {
    if (!fs.existsSync(tmpdirAgentKycDir)) {
      fs.mkdirSync(tmpdirAgentKycDir, { recursive: true, mode: 0o755 });
    }
  } catch (_) {}
  return tmpdirAgentKycDir;
}

/**
 * Returns a writable agent KYC upload directory (absolute path).
 * Never throws for permission errors – always falls back to tmpdir.
 */
export function getWritableAgentKycUploadDir() {
  let current = getAgentKycUploadDir();

  // Ensure path is absolute
  if (!path.isAbsolute(current)) {
    console.warn('[Upload] Warning: getAgentKycUploadDir returned relative path:', current);
    current = path.resolve(process.cwd(), current);
  }

  try {
    if (!fs.existsSync(current)) {
      console.log('[Upload] Creating agentKyc dir:', current);
      fs.mkdirSync(current, { recursive: true, mode: 0o755 });
    }
    fs.accessSync(current, fs.constants.W_OK);
    return current;
  } catch (err) {
    console.error(`[Upload] Failed to access/create ${current}:`, err.message);

    // Switch to tmpdir and retry
    try {
      if (!fs.existsSync(tmpdirAgentKycDir)) {
        fs.mkdirSync(tmpdirAgentKycDir, { recursive: true, mode: 0o755 });
      }
      fs.accessSync(tmpdirAgentKycDir, fs.constants.W_OK);
    } catch (_) {
      try {
        fs.mkdirSync(tmpdirAgentKycDir, { recursive: true, mode: 0o777 });
      } catch (__) { }
    }
    console.warn('[Upload] Using tmpdir fallback for agentKyc:', tmpdirAgentKycDir);
    return tmpdirAgentKycDir;
  }
}
