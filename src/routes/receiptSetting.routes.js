import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getReceiptSettings, updateReceiptSettings } from '../controllers/receiptSetting.controller.js';

const router = express.Router();

router.get('/', authenticateToken, getReceiptSettings);
router.put('/', authenticateToken, updateReceiptSettings);

export default router;

