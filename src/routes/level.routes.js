import express from 'express';
import { getLevels, getLevelById, createLevel, updateLevel, deleteLevel } from '../controllers/level.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, getLevels);
router.get('/:id', authenticateToken, getLevelById);
router.post('/', authenticateToken, createLevel);
router.patch('/:id', authenticateToken, updateLevel);
router.delete('/:id', authenticateToken, deleteLevel);

export default router;
