import express from 'express';
import {
  getAllTaxFees,
  getTaxFeeById,
  createTaxFee,
  updateTaxFee,
  deleteTaxFee,
} from '../controllers/taxFee.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', getAllTaxFees);
router.get('/:id', getTaxFeeById);
router.post('/', authenticateToken, createTaxFee);
router.put('/:id', authenticateToken, updateTaxFee);
router.delete('/:id', authenticateToken, deleteTaxFee);

export default router;
