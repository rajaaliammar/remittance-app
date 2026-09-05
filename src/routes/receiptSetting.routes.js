import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getReceiptSettings, updateReceiptSettings } from '../controllers/receiptSetting.controller.js';

const router = express.Router();

// GET is public so the mobile app can render portal-managed receipt disclosures.
router.get('/', getReceiptSettings);
router.put('/', authenticateToken, updateReceiptSettings);

export default router;

