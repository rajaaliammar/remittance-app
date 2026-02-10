import express from 'express';
import {
  getAllKYCForms,
  getKYCFormById,
  createKYCForm,
  updateKYCForm,
  deleteKYCForm,
  getCustomerKYCDocuments,
  approveKYCDocument,
  rejectKYCDocument,
  approveKYCDocumentField,
  rejectKYCDocumentField,
  getKYCFormsByCountry,
  submitKYCForm
} from '../controllers/kyc.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { authenticateCustomer } from '../middleware/customerAuth.js';

const router = express.Router();

// KYC Form management
router.get('/forms', authenticateToken, getAllKYCForms);
router.get('/forms/:id', authenticateToken, getKYCFormById);
router.post('/forms', authenticateToken, createKYCForm);
router.put('/forms/:id', authenticateToken, updateKYCForm);
router.delete('/forms/:id', authenticateToken, deleteKYCForm);
// Public endpoint - no authentication required for getting forms by country
router.get('/forms/country/:countryCode', getKYCFormsByCountry);

// Customer KYC form submission (requires customer authentication)
router.post('/forms/submit', authenticateCustomer, submitKYCForm);

// Customer KYC documents
router.get('/customers/:id/documents', authenticateToken, getCustomerKYCDocuments);
router.post('/customers/:customerId/documents/:documentId/approve', authenticateToken, approveKYCDocument);
router.post('/customers/:customerId/documents/:documentId/reject', authenticateToken, rejectKYCDocument);
// Individual field approval/rejection
router.post('/customers/:customerId/documents/:documentId/fields/:fieldId/approve', authenticateToken, approveKYCDocumentField);
router.post('/customers/:customerId/documents/:documentId/fields/:fieldId/reject', authenticateToken, rejectKYCDocumentField);

export default router;
