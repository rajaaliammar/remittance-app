import express from 'express';
import { 
  signup as customerSignup,
  sendOTP,
  verifyOTP,
  completeProfile,
  uploadKycDocument,
  setPin,
  upload
} from '../controllers/customer.controller.js';
import { authenticateCustomer } from '../middleware/customerAuth.js';

const router = express.Router();

/**
 * Mobile app compatibility: POST /api/accounts/signup and /api/accounts/signup/
 * Forwards to customer signup.
 */
router.post('/signup', customerSignup);
router.post('/signup/', customerSignup);

// OTP endpoints
router.post('/send-otp', sendOTP);
router.post('/send-otp/', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/verify-otp/', verifyOTP);

// Profile completion (requires authentication)
router.post('/complete-profile', authenticateCustomer, completeProfile);
router.post('/complete-profile/', authenticateCustomer, completeProfile);

// KYC document upload (requires authentication)
router.post('/upload-kyc-document', authenticateCustomer, upload.single('document'), uploadKycDocument);
router.post('/upload-kyc-document/', authenticateCustomer, upload.single('document'), uploadKycDocument);

// Set PIN (requires authentication)
router.post('/set-pin', authenticateCustomer, setPin);
router.post('/set-pin/', authenticateCustomer, setPin);

export default router;
