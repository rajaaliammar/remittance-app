import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { uploadNotificationImageMulter, uploadNotificationImage } from '../controllers/customer.controller.js';

const router = express.Router();

// Portal admin: upload image for notification (returns URL to use in send-notification)
router.post(
  '/notification-image',
  authenticateToken,
  (req, res, next) => {
    uploadNotificationImageMulter.single('image')(req, res, (err) => {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 5MB or less.' : (err.message || 'Invalid file.');
        return res.status(400).json({ success: false, message });
      }
      next();
    });
  },
  uploadNotificationImage
);

export default router;
