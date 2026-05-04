import express from 'express';
import {
  getAllCountries,
  getAllCountriesFromAPI,
  getCountryById,
  getCountrySuggestions,
  getCountryDetails,
  createCountry,
  updateCountry,
  deleteCountry
} from '../controllers/country.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes for suggestions and country details (for better UX)
// Country details: https://restcountries.com (free). Use ?iso2=US for correct dial codes (e.g. +1 for US).
router.get('/suggestions', getCountrySuggestions);
router.get('/details', getCountryDetails);
router.get('/all', getAllCountriesFromAPI); // Get all countries from third-party API

// Public listing of countries (used by Remittance Portal + POS mobile app)
// Other country management routes remain protected.
router.get('/', getAllCountries);
router.get('/:id', authenticateToken, getCountryById);
router.post('/', authenticateToken, createCountry);
router.put('/:id', authenticateToken, updateCountry);
router.patch('/:id', authenticateToken, updateCountry);
router.delete('/:id', authenticateToken, deleteCountry);

export default router;

