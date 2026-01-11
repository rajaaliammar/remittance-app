import express from 'express';
import {
  getAllManageContent,
  getManageContentByType,
  upsertManageContent,
  updateManageContent,
  deleteManageContent
} from '../controllers/manageContent.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all manage content sections (public - no authentication required)
router.get('/', getAllManageContent);

// Get manage content by section type (public - no authentication required)
router.get('/:sectionType', getManageContentByType);

// Create or update manage content (upsert by section type) - requires authentication
router.post('/', authenticateToken, upsertManageContent);

// Update manage content by ID - requires authentication
router.put('/:id', authenticateToken, updateManageContent);

// Delete manage content - requires authentication
router.delete('/:id', authenticateToken, deleteManageContent);

export default router;

