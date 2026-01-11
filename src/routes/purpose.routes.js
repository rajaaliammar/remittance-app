import express from 'express';
import {
  getAllPurposes,
  getPurposeById,
  createPurpose,
  updatePurpose,
  deletePurpose
} from '../controllers/purpose.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all purposes (public endpoint for frontend forms)
router.get('/', getAllPurposes);

// Get purpose by ID (public endpoint for frontend forms)
router.get('/:id', getPurposeById);

// Create new purpose
router.post('/', authenticateToken, createPurpose);

// Update purpose
router.put('/:id', authenticateToken, updatePurpose);

// Delete purpose
router.delete('/:id', authenticateToken, deletePurpose);

export default router;




