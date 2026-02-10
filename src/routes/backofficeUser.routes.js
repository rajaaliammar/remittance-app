import express from 'express';
import {
  inviteUser,
  getInvitationDetails,
  completeProfile,
  getAllUsers,
  updateBackofficeUser,
  approveUser,
  rejectUser,
  deleteUser,
  login
} from '../controllers/backofficeUser.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/login', login);
router.get('/invite/:token', getInvitationDetails);
router.post('/complete-profile/:token', completeProfile);

// Protected routes (require authentication)
router.post('/invite', authenticateToken, inviteUser);
router.get('/', authenticateToken, getAllUsers);
router.patch('/:id', authenticateToken, updateBackofficeUser);
router.post('/approve/:id', authenticateToken, approveUser);
router.post('/reject/:id', authenticateToken, rejectUser);
router.delete('/:id', authenticateToken, deleteUser);

export default router;

