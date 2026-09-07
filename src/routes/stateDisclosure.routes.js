import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authenticateCustomer } from '../middleware/customerAuth.js';
import {
  listStateDisclosures,
  createStateDisclosure,
  updateStateDisclosure,
  deleteStateDisclosure,
  listUsStates,
  getDisclosureForCustomer,
  getDisclosureForMe,
  seedMsbStateDisclosures,
} from '../controllers/stateDisclosure.controller.js';

const router = express.Router();

router.get('/us-states', listUsStates);
router.get('/for-me', authenticateCustomer, getDisclosureForMe);
router.get('/for-customer/:customerId', getDisclosureForCustomer);
router.post('/seed-msb', authenticateToken, seedMsbStateDisclosures);

router.get('/', listStateDisclosures);
router.post('/', authenticateToken, createStateDisclosure);
router.put('/:id', authenticateToken, updateStateDisclosure);
router.delete('/:id', authenticateToken, deleteStateDisclosure);

export default router;
