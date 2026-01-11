import express from 'express';
import {
  getAllManualGateways,
  getManualGatewayById,
  createManualGateway,
  updateManualGateway,
  deleteManualGateway
} from '../controllers/manualGateway.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all manual gateways (public read access)
router.get('/', getAllManualGateways);

// Get manual gateway by ID (public read access)
router.get('/:id', getManualGatewayById);

// Create manual gateway (requires authentication)
router.post('/', authenticateToken, createManualGateway);

// Update manual gateway (requires authentication)
router.put('/:id', authenticateToken, updateManualGateway);

// Delete manual gateway (requires authentication)
router.delete('/:id', authenticateToken, deleteManualGateway);

export default router;

