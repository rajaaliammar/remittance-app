import express from 'express';
import {
  getAllServices,
  getServiceById,
  createService,
  updateService,
  deleteService
} from '../controllers/service.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all services (public endpoint for frontend forms)
router.get('/', getAllServices);

// Get service by ID (public endpoint for frontend forms)
router.get('/:id', getServiceById);

// Create new service
router.post('/', authenticateToken, createService);

// Update service
router.put('/:id', authenticateToken, updateService);

// Delete service
router.delete('/:id', authenticateToken, deleteService);

export default router;




