import express from 'express';
import {
  getCountryStates,
  getStateById,
  createState,
  updateState,
  deleteState,
  getCountryInfoForStates
} from '../controllers/state.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get country info (for displaying country name)
router.get('/country/:countryId/info', authenticateToken, getCountryInfoForStates);

// Get all states for a country
router.get('/country/:countryId/states', authenticateToken, getCountryStates);

// Get state by ID
router.get('/:id', authenticateToken, getStateById);

// Create new state
router.post('/', authenticateToken, createState);

// Update state
router.put('/:id', authenticateToken, updateState);

// Delete state
router.delete('/:id', authenticateToken, deleteState);

export default router;









