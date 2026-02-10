import express from 'express';
import { login as customerLogin } from '../controllers/customer.controller.js';

const router = express.Router();

/**
 * Mobile app compatibility: POST /api/auth/login
 * Forwards to customer login (same body: username/email + password).
 */
router.post('/login', customerLogin);

export default router;
