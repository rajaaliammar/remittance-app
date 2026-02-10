import express from 'express';
import {
  getUserRegistrationSettings,
  updateUserRegistrationSettings,
} from '../controllers/registrationSetting.controller.js';
// import { authenticateToken } from '../middleware/auth.js'; // Uncomment if you want to protect the update route

const router = express.Router();

// GET /api/registration-setting/user-setting - Get registration settings (public)
router.get('/user-setting', getUserRegistrationSettings);

// PUT /api/registration-setting/user-setting - Update registration settings (should be protected in production)
router.put('/user-setting', updateUserRegistrationSettings);
// router.put('/user-setting', authenticateToken, updateUserRegistrationSettings); // Use this if you want to protect the route

export default router;
