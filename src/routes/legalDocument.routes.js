import express from 'express';
import { authenticateToken, optionalAuthenticateToken } from '../middleware/auth.js';
import {
  getLegalDocuments,
  getLegalDocumentByType,
  upsertLegalDocument,
  clearLegalDocument,
} from '../controllers/legalDocument.controller.js';

const router = express.Router();

// GET /api/legal-documents — public (published); admin sees all when authenticated
router.get('/', optionalAuthenticateToken, getLegalDocuments);

// GET /api/legal-documents/:docType
router.get('/:docType', optionalAuthenticateToken, getLegalDocumentByType);

// PUT /api/legal-documents/:docType — admin upsert
router.put('/:docType', authenticateToken, upsertLegalDocument);

// DELETE /api/legal-documents/:docType — admin clear / unpublish
router.delete('/:docType', authenticateToken, clearLegalDocument);

export default router;
