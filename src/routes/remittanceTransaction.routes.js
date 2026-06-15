import express from 'express';
import {
  createRemittanceTransaction,
  listRemittanceTransactions,
  listAllRemittanceTransactions,
  getRemittanceTransactionById,
  sendRemittanceTransactionReceipt,
  rejectRemittanceTransaction,
  updateRemittanceTransaction,
} from '../controllers/remittanceTransaction.controller.js';
import { authenticateCustomer } from '../middleware/customerAuth.js';
import { authenticateToken } from '../middleware/auth.js';
import { authenticateCustomerOrBackoffice } from '../middleware/customerOrBackofficeAuth.js';

const router = express.Router();

router.post('/', authenticateCustomer, createRemittanceTransaction);
router.get('/', authenticateCustomer, listRemittanceTransactions);
router.get('/all', authenticateToken, listAllRemittanceTransactions);
router.get('/:id', authenticateCustomerOrBackoffice, getRemittanceTransactionById);
router.put('/:id', authenticateToken, updateRemittanceTransaction);
router.post('/:id/send-receipt', authenticateToken, sendRemittanceTransactionReceipt);
router.post('/:id/reject', authenticateToken, rejectRemittanceTransaction);

export default router;
