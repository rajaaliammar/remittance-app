import express from 'express';
import {
  getGiftRules,
  createGiftRule,
  updateGiftRule,
  deleteGiftRule,
} from '../controllers/remittanceBankGift.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// List all gift rules for a bank
// Public read access so POS mobile app can fetch gift rules without remittance-backend authentication
router.get('/remittance-banks/:bankId/gifts', getGiftRules);

// Create a new gift rule for a bank
router.post('/remittance-banks/:bankId/gifts', authenticateToken, createGiftRule);

// Update an existing gift rule
router.put('/remittance-banks/:bankId/gifts/:id', authenticateToken, updateGiftRule);

// Delete a gift rule
router.delete('/remittance-banks/:bankId/gifts/:id', authenticateToken, deleteGiftRule);

export default router;


