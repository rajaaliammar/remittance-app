import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  listStateDisclosures,
  createStateDisclosure,
  updateStateDisclosure,
  deleteStateDisclosure,
} from '../controllers/stateDisclosure.controller.js';

const router = express.Router();

router.get('/', listStateDisclosures);
router.post('/', authenticateToken, createStateDisclosure);
router.put('/:id', authenticateToken, updateStateDisclosure);
router.delete('/:id', authenticateToken, deleteStateDisclosure);

export default router;

