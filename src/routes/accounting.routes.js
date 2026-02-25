import express from 'express';
import {
  getAccountingSummary,
  getAccountingEntries,
  createAccountingEntry,
  getAccountingEntryById,
  updateAccountingEntry,
  deleteAccountingEntry,
  getRevenueBreakdown,
  getExpenseBreakdown,
  getProfitLossReport,
  getReconciliationReport,
  exportAccountingData,
  syncFromTransactions,
} from '../controllers/accounting.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/summary', getAccountingSummary);
router.get('/entries', getAccountingEntries);
router.post('/entries', createAccountingEntry);
router.get('/entries/:id', getAccountingEntryById);
router.put('/entries/:id', updateAccountingEntry);
router.delete('/entries/:id', deleteAccountingEntry);
router.get('/revenue/breakdown', getRevenueBreakdown);
router.get('/expense/breakdown', getExpenseBreakdown);
router.get('/profit-loss', getProfitLossReport);
router.get('/reconcile', getReconciliationReport);
router.get('/export', exportAccountingData);
router.post('/sync-from-transactions', syncFromTransactions);

export default router;
