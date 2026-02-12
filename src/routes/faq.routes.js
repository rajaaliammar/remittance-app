import express from 'express';
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

// POST /api/faqs - Create (portal)
router.post('/', createFaq);

// PUT /api/faqs/:id - Update (portal)
router.put('/:id', updateFaq);

// DELETE /api/faqs/:id - Delete (portal)
router.delete('/:id', deleteFaq);

export default router;
