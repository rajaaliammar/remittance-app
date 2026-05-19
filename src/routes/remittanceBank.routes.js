import express from 'express';
import {
  getAllRemittanceBanks,
  getRemittanceBankById,
  createRemittanceBank,
  updateRemittanceBank,
  deleteRemittanceBank,
  getBanksByCountry,
  verifyBankAccount,
} from '../controllers/remittanceBank.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all remittance banks
// Public read access so POS mobile + Remittance Portal can list banks
router.get('/', getAllRemittanceBanks);

// Get remittance banks by country (public endpoint for frontend forms)
router.get('/country/:countryId', getBanksByCountry);

// Verify bank account and return account holder name (public for send-money flow)
router.post('/verify-account', verifyBankAccount);
router.post('/verify-account/', verifyBankAccount);

// Get remittance bank by ID
router.get('/:id', authenticateToken, getRemittanceBankById);

// Create new remittance bank
router.post('/', authenticateToken, createRemittanceBank);

// Update remittance bank
router.put('/:id', authenticateToken, updateRemittanceBank);

// Delete remittance bank
router.delete('/:id', authenticateToken, deleteRemittanceBank);

export default router;




