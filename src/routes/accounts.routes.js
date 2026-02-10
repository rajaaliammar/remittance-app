import express from 'express';
import { signup as customerSignup } from '../controllers/customer.controller.js';

const router = express.Router();

/**
 * Mobile app compatibility: POST /api/accounts/signup and /api/accounts/signup/
 * Forwards to customer signup.
 */
router.post('/signup', customerSignup);
router.post('/signup/', customerSignup);

export default router;
