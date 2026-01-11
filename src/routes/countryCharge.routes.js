import express from 'express';
import {
  getCountryCharges,
  upsertCountryCharges,
  deleteCountryCharges
} from '../controllers/countryCharge.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get charges for a country
router.get('/country/:countryId', authenticateToken, getCountryCharges);

// Create or update charges for a country
router.put('/country/:countryId', authenticateToken, upsertCountryCharges);

// Delete charges for a country
router.delete('/country/:countryId', authenticateToken, deleteCountryCharges);

export default router;









