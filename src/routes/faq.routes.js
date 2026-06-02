import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getFaqs,
  getFaqById,
  createFaq,
  updateFaq,
  deleteFaq,
} from '../controllers/faq.controller.js';

const router = express.Router();

// GET /api/faqs - List all (public, for app and portal)
router.get('/', getFaqs);

// GET /api/faqs/:id - Get one (for portal edit)
router.get('/:id', getFaqById);

// POST /api/faqs - Create (portal admin)
router.post('/', authenticateToken, createFaq);

// PUT /api/faqs/:id - Update (portal admin)
router.put('/:id', authenticateToken, updateFaq);

// DELETE /api/faqs/:id - Delete (portal admin)
router.delete('/:id', authenticateToken, deleteFaq);

export default router;
