import express from 'express';
import { authenticateCustomer } from '../middleware/customerAuth.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  createCustomer,
  addCard,
  listCards,
  deleteCard,
  chargeCard,
  adminListCustomerCards,
} from '../controllers/acceptblue.controller.js';

const router = express.Router();

// Customer-facing endpoints (mobile app / portal checkout)
router.post('/customers', authenticateCustomer, createCustomer);
router.post('/cards', authenticateCustomer, addCard);
router.get('/cards', authenticateCustomer, listCards);
router.delete('/cards/:id', authenticateCustomer, deleteCard);
router.post('/charge', authenticateCustomer, chargeCard);

// Admin/backoffice endpoint
router.get('/admin/customers/:customerId/cards', authenticateToken, adminListCustomerCards);

export default router;
