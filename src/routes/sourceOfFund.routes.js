import express from 'express';
import {
  getAllSourceOfFunds,
  getSourceOfFundById,
  createSourceOfFund,
  updateSourceOfFund,
  deleteSourceOfFund
} from '../controllers/sourceOfFund.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all source of funds (public endpoint for frontend forms)
router.get('/', getAllSourceOfFunds);

// Get source of fund by ID (public endpoint for frontend forms)
router.get('/:id', getSourceOfFundById);

// Create new source of fund
router.post('/', authenticateToken, createSourceOfFund);

// Update source of fund
router.put('/:id', authenticateToken, updateSourceOfFund);

// Delete source of fund
router.delete('/:id', authenticateToken, deleteSourceOfFund);

export default router;




