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
  listAmlTransactions,
  getAmlTransactionStatus,
  getAmlTransactionCaseStatus,
  getAmlTransactionTmsDetails,
  getAmlTransactionFullDetail,
  updateAmlTransactionStatus,
  syncAmlRemittanceTransaction,
  listLocalRemittanceAml,
} from '../controllers/amlAdmin.controller.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/customers/resolve', resolveAmlCustomerIdentifier);
router.get('/customers/listing', listAmlCustomers);

router.post('/transactions/listing', listAmlTransactions);
router.get('/transactions/local', listLocalRemittanceAml);
router.post('/transactions/sync-remittance/:transactionId', syncAmlRemittanceTransaction);
router.post('/transactions/update-status', updateAmlTransactionStatus);
router.get('/transactions/:trIdDisplay/status', getAmlTransactionStatus);
router.get('/transactions/:trIdDisplay/case-status', getAmlTransactionCaseStatus);
router.get('/transactions/:trIdDisplay/tms-details', getAmlTransactionTmsDetails);
router.get('/transactions/:trIdDisplay', getAmlTransactionFullDetail);
router.get('/customers/:clientNumber/exists', checkAmlCustomerExists);
router.get('/customers/:clientNumber/status', getAmlCustomerStatus);
router.get('/customers/:clientNumber/documents/:docId/view', viewAmlCustomerDocument);
router.get('/customers/:clientNumber/documents', getAmlCustomerDocuments);
router.put('/customers/:clientNumber/name', updateAmlCustomerName);

export default router;
