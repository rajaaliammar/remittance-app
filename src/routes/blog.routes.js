import express from 'express';
import {
  getAllBlogs,
  getBlogById,
  getBlogBySlug,
  createBlog,
  updateBlog,
  deleteBlog
} from '../controllers/blog.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all blogs (public endpoint, can filter by language, status, categoryId)
router.get('/', getAllBlogs);

// Get blog by slug (public endpoint)
router.get('/slug/:slug', getBlogBySlug);

// Get blog by ID (public endpoint)
router.get('/:id', getBlogById);

// Create blog (protected)
router.post('/', authenticateToken, createBlog);

// Update blog (protected)
router.put('/:id', authenticateToken, updateBlog);

// Delete blog (protected)
router.delete('/:id', authenticateToken, deleteBlog);

export default router;

