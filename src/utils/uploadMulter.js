/**
 * Multer configurations — memory buffer when S3 is enabled, disk otherwise.
 */
import multer from 'multer';
import path from 'path';
import os from 'os';
import fsSync from 'fs';
import {
  getWritableKycUploadDir,
  getNotificationUploadDir,
  getCountryServiceUploadDir,
  getUploadsBase,
} from './uploadPath.js';
import { isObjectStorageEnabled, generateUploadFilename } from './objectStorage.js';

const TMPDIR_KYC = path.join(os.tmpdir(), 'remittance-kyc-uploads', 'kyc');

function kycDiskStorage() {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      let uploadDir;
      try {
        uploadDir = getWritableKycUploadDir();
      } catch (err) {
        try {
          if (!fsSync.existsSync(TMPDIR_KYC)) {
            fsSync.mkdirSync(TMPDIR_KYC, { recursive: true, mode: 0o755 });
          }
          uploadDir = TMPDIR_KYC;
        } catch (e) {
          return cb(e);
        }
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, generateUploadFilename(file.fieldname, file.originalname));
    },
  });
}

function diskStorageForDir(getDir, filenameBuilder) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, getDir());
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      cb(null, filenameBuilder(file));
    },
  });
}

const kycFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (mimetype && extname) return cb(null, true);
  cb(new Error('Only images (JPEG, JPG, PNG) and PDF files are allowed'));
};

const imageFileFilter = (allowed, errorMsg) => (req, file, cb) => {
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) return cb(null, true);
  cb(new Error(errorMsg));
};

const kycStorage = isObjectStorageEnabled() ? multer.memoryStorage() : kycDiskStorage();

export const upload = multer({
  storage: kycStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: kycFileFilter,
});

const notificationStorage = isObjectStorageEnabled()
  ? multer.memoryStorage()
  : diskStorageForDir(getNotificationUploadDir, (file) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      return `notification-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    });

export const uploadNotificationImageMulter = multer({
  storage: notificationStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter(
    /jpeg|jpg|png|gif|webp/,
    'Only images (JPEG, PNG, GIF, WebP) are allowed',
  ),
});

const countryServiceStorage = isObjectStorageEnabled()
  ? multer.memoryStorage()
  : diskStorageForDir(getCountryServiceUploadDir, (file) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      return `country-service-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    });

export const uploadCountryServiceImageMulter = multer({
  storage: countryServiceStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter(
    /jpeg|jpg|png|gif|webp/,
    'Only images (JPEG, PNG, GIF, WebP) are allowed',
  ),
});

/** CMS / portal content images — stored in S3 or uploads/cms/ (never base64 in DB). */
function getCmsUploadDir() {
  const dir = path.join(getUploadsBase(), 'cms');
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  return dir;
}

const cmsStorage = isObjectStorageEnabled()
  ? multer.memoryStorage()
  : diskStorageForDir(getCmsUploadDir, (file) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      return `cms-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    });

export const uploadCmsImageMulter = multer({
  storage: cmsStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter(
    /jpeg|jpg|png|gif|webp|svg/,
    'Only images (JPEG, PNG, GIF, WebP, SVG) are allowed',
  ),
});
