import express from 'express';
import {
  createRemittanceTransaction,
  listRemittanceTransactions,
  listAllRemittanceTransactions,
  getRemittanceTransactionById,
} from '../controllers/remittanceTransaction.controller.js';
import { authenticateCustomer } from '../middleware/customerAuth.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticateCustomer, createRemittanceTransaction);
router.get('/', authenticateCustomer, listRemittanceTransactions);
router.get('/all', authenticateToken, listAllRemittanceTransactions);
router.get('/:id', authenticateToken, getRemittanceTransactionById);

export default router;
