import express from 'express';
import {
  getAllPaymentGateways,
  getPaymentGatewayById,
  createPaymentGateway,
  updatePaymentGateway,
  deletePaymentGateway
} from '../controllers/paymentGateway.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all payment gateways (public read access)
router.get('/', getAllPaymentGateways);

// Get payment gateway by ID (public read access)
router.get('/:id', getPaymentGatewayById);

// Create payment gateway (requires authentication)
router.post('/', authenticateToken, createPaymentGateway);

// Update payment gateway (requires authentication)
router.put('/:id', authenticateToken, updatePaymentGateway);

// Delete payment gateway (requires authentication)
router.delete('/:id', authenticateToken, deletePaymentGateway);

export default router;

