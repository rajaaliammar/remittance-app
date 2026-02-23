import express from 'express';
import {
  getOrchestrationStatus,
  listOrchestrationJobs,
  getOrchestrationJobById,
  listOrchestrationEvents,
} from '../controllers/orchestration.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, getOrchestrationStatus);
router.get('/jobs', authenticateToken, listOrchestrationJobs);
router.get('/jobs/:id', authenticateToken, getOrchestrationJobById);
router.get('/events', authenticateToken, listOrchestrationEvents);

export default router;
