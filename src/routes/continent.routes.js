import express from 'express';
import {
  getAllContinents,
  getContinentById,
  getContinentSuggestions,
  createContinent,
  updateContinent,
  deleteContinent
} from '../controllers/continent.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public route for suggestions (can be used without auth for better UX)
router.get('/suggestions', getContinentSuggestions);

// All other routes require authentication
router.get('/', authenticateToken, getAllContinents);
router.get('/:id', authenticateToken, getContinentById);
router.post('/', authenticateToken, createContinent);
router.put('/:id', authenticateToken, updateContinent);
router.delete('/:id', authenticateToken, deleteContinent);

export default router;

