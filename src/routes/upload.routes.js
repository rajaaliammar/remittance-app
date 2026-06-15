import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  uploadNotificationImageMulter,
  uploadNotificationImage,
  uploadCountryServiceImageMulter,
  uploadCountryServiceImage,
} from '../controllers/customer.controller.js';
import { uploadCmsImageMulter } from '../utils/uploadMulter.js';
import { uploadCmsImage } from '../controllers/upload.controller.js';

const router = express.Router();

function multerSingle(multerInstance, fieldName, sizeMessage) {
  return (req, res, next) => {
    multerInstance.single(fieldName)(req, res, (err) => {
      if (err) {
        const message =
          err.code === 'LIMIT_FILE_SIZE' ? sizeMessage : err.message || 'Invalid file.';
        return res.status(400).json({ success: false, message });
      }
      next();
    });
  };
}

// Portal: CMS / logo / flag images — returns URL (S3 or /uploads/cms/...) for DB storage
router.post(
  '/cms-image',
  authenticateToken,
  multerSingle(uploadCmsImageMulter, 'image', 'Image must be 5MB or less.'),
  uploadCmsImage,
);

// Alias for clarity
router.post(
  '/image',
  authenticateToken,
  multerSingle(uploadCmsImageMulter, 'image', 'Image must be 5MB or less.'),
  uploadCmsImage,
);

// Portal admin: upload image for notification (returns URL to use in send-notification)
router.post(
  '/notification-image',
  authenticateToken,
  multerSingle(uploadNotificationImageMulter, 'image', 'Image must be 5MB or less.'),
  uploadNotificationImage
);

// Portal admin: display image for country service (mobile app)
router.post(
  '/country-service-image',
  authenticateToken,
  multerSingle(uploadCountryServiceImageMulter, 'image', 'Image must be 5MB or less.'),
  uploadCountryServiceImage
);

export default router;
