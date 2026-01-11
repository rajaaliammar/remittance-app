import express from 'express';
import {
  getAllPages,
  getPageById,
  getPageBySlug,
  createPage,
  updatePage,
  deletePage
} from '../controllers/page.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all pages
router.get('/', authenticateToken, getAllPages);

// Get page by slug (public route for frontend pages)
router.get('/slug/:slug', getPageBySlug);

// Get page by ID
router.get('/:id', authenticateToken, getPageById);

// Create new page
router.post('/', authenticateToken, createPage);

// Update page
router.put('/:id', authenticateToken, updatePage);

// Delete page
router.delete('/:id', authenticateToken, deletePage);

export default router;


