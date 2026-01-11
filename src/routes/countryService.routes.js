import express from 'express';
import {
  getCountryServices,
  getServiceById,
  createService,
  updateService,
  deleteService,
  getCountryInfo
} from '../controllers/countryService.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get country info (for displaying currency name)
// Public read access so Remittance Portal + POS mobile can display currency data
router.get('/country/:countryId/info', getCountryInfo);

// Get all services for a country
// Public read access so client apps can list Bank Transfer / Cash Pick-up options
router.get('/country/:countryId/services', getCountryServices);

// Get service by ID
router.get('/:id', authenticateToken, getServiceById);

// Create new service
router.post('/', authenticateToken, createService);

// Update service
router.put('/:id', authenticateToken, updateService);

// Delete service
router.delete('/:id', authenticateToken, deleteService);

export default router;









