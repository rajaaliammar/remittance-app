import express from 'express';
import {
  listComplianceAlerts,
  getComplianceAlertById,
  listHeldTransactions,
  approveHeldTransaction,
  rejectHeldTransaction,
  getCustomerRiskProfile,
  getComplianceStats,
} from '../controllers/compliance.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All compliance endpoints require backoffice authentication
router.use(authenticateToken);

// Dashboard stats
router.get('/stats', getComplianceStats);

// Compliance alerts
router.get('/alerts', listComplianceAlerts);
router.get('/alerts/:id', getComplianceAlertById);

// Held transactions
router.get('/held-transactions', listHeldTransactions);
router.post('/held-transactions/:id/approve', approveHeldTransaction);
router.post('/held-transactions/:id/reject', rejectHeldTransaction);

// Customer risk profile
router.get('/risk-score/:customerId', getCustomerRiskProfile);

export default router;
