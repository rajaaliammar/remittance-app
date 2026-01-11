import express from 'express';
import {
  getAllRemittanceWallets,
  getRemittanceWalletById,
  createRemittanceWallet,
  updateRemittanceWallet,
  deleteRemittanceWallet,
  getWalletsByCountry
} from '../controllers/remittanceWallet.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all remittance wallets (public endpoint for frontend forms)
router.get('/', getAllRemittanceWallets);

// Get remittance wallets by country (public endpoint for frontend forms)
router.get('/country/:countryId', getWalletsByCountry);

// Get remittance wallet by ID
router.get('/:id', authenticateToken, getRemittanceWalletById);

// Create new remittance wallet
router.post('/', authenticateToken, createRemittanceWallet);

// Update remittance wallet
router.put('/:id', authenticateToken, updateRemittanceWallet);

// Delete remittance wallet
router.delete('/:id', authenticateToken, deleteRemittanceWallet);

export default router;




