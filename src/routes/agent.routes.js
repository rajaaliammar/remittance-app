import express from 'express';
import { 
  signup, 
  login, 
  getAllAgents, 
  getAgentById, 
  approveAgent, 
  rejectAgent, 
  deleteAgent 
} from '../controllers/agent.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/signup', signup);
router.post('/login', login);

// Protected routes (require authentication)
router.get('/', authenticateToken, getAllAgents);
router.get('/:id', authenticateToken, getAgentById);
router.post('/approve/:id', authenticateToken, approveAgent);
router.post('/reject/:id', authenticateToken, rejectAgent);
router.delete('/:id', authenticateToken, deleteAgent);

export default router;

