import express from 'express';
import {
  getAllEmploymentStatuses,
  getEmploymentStatusById,
  createEmploymentStatus,
  updateEmploymentStatus,
  deleteEmploymentStatus,
} from '../controllers/employmentStatus.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', getAllEmploymentStatuses);
router.get('/:id', getEmploymentStatusById);
router.post('/', authenticateToken, createEmploymentStatus);
router.put('/:id', authenticateToken, updateEmploymentStatus);
router.delete('/:id', authenticateToken, deleteEmploymentStatus);

export default router;
