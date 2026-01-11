import express from 'express';
import {
  getAllBlogCategories,
  getBlogCategoryById,
  createBlogCategory,
  updateBlogCategory,
  deleteBlogCategory
} from '../controllers/blogCategory.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all blog categories (public endpoint)
router.get('/', getAllBlogCategories);

// Get blog category by ID (public endpoint)
router.get('/:id', getBlogCategoryById);

// Create blog category (protected)
router.post('/', authenticateToken, createBlogCategory);

// Update blog category (protected)
router.put('/:id', authenticateToken, updateBlogCategory);

// Delete blog category (protected)
router.delete('/:id', authenticateToken, deleteBlogCategory);

export default router;

