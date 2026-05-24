import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  listAmlCustomers,
  resolveAmlCustomerIdentifier,
  checkAmlCustomerExists,
  getAmlCustomerStatus,
  getAmlCustomerDocuments,
  viewAmlCustomerDocument,
  updateAmlCustomerName,
} from '../controllers/amlAdmin.controller.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/customers/resolve', resolveAmlCustomerIdentifier);
router.get('/customers/listing', listAmlCustomers);
router.get('/customers/:clientNumber/exists', checkAmlCustomerExists);
router.get('/customers/:clientNumber/status', getAmlCustomerStatus);
router.get('/customers/:clientNumber/documents/:docId/view', viewAmlCustomerDocument);
router.get('/customers/:clientNumber/documents', getAmlCustomerDocuments);
router.put('/customers/:clientNumber/name', updateAmlCustomerName);

export default router;
