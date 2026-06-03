import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getLastUpdateDate,
  validateIp,
  getMaxOccupationId,
  createBusinessActivity,
  createOccupation,
  getActiveRules,
} from '../controllers/utilities.controller.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/last-update-date', getLastUpdateDate);
router.post('/validate-ip', validateIp);
router.get('/max-occupation-id', getMaxOccupationId);
router.post('/business-activity', createBusinessActivity);
router.post('/occupation', createOccupation);
router.get('/active-rules', getActiveRules);

export default router;
