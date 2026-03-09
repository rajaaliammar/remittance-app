import express from 'express';
import { 
  signup, 
  login, 
  getAllAgents, 
  getAgentById, 
  updateAgent,
  approveAgent, 
  rejectAgent, 
  deleteAgent,
  inviteAgent,
  getInvitationDetails,
  completeOnboarding,
  updateAgentDocumentStatus
} from '../controllers/agent.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/signup', signup);
router.post('/login', login);
router.get('/invite/:token', getInvitationDetails);
router.post('/onboarding/:token', completeOnboarding);

// Protected routes (require authentication)
router.get('/', authenticateToken, getAllAgents);
router.get('/:id', authenticateToken, getAgentById);
router.patch('/:id', authenticateToken, updateAgent);
router.post('/approve/:id', authenticateToken, approveAgent);
router.post('/reject/:id', authenticateToken, rejectAgent);
router.post('/:id/documents/:documentField/:status', authenticateToken, updateAgentDocumentStatus);
router.delete('/:id', authenticateToken, deleteAgent);
router.post('/invite', authenticateToken, inviteAgent);

export default router;

