import express from 'express';
import { 
  getMenuByType, 
  getAllMenus, 
  saveMenu, 
  deleteMenu 
} from '../controllers/menu.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public route - Get menu by type (for frontend)
router.get('/:menuType', getMenuByType);

// Protected routes (require authentication)
router.get('/', authenticateToken, getAllMenus);
router.post('/', authenticateToken, saveMenu);
router.put('/:menuType', authenticateToken, saveMenu);
router.delete('/:menuType', authenticateToken, deleteMenu);

export default router;

