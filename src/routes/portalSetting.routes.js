import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getPortalSettings,
  getPublicPortalSettings,
  updatePortalSettings,
} from '../controllers/portalSetting.controller.js';

const router = express.Router();

router.get('/public', getPublicPortalSettings);
router.get('/', authenticateToken, getPortalSettings);
router.put('/', authenticateToken, updatePortalSettings);

export default router;
