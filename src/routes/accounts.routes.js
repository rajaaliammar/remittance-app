import express from 'express';
import { 
  signup as customerSignup,
  sendOTP,
  verifyOTP,
  loginWithPin,
  completeProfile,
  uploadKycDocument,
  saveKycDetails,
  setPin,
  getBalance,
  getProfile,
  updatePushToken,
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
router.post('/login-otp', sendOTP);
router.post('/login-otp/', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/verify-otp/', verifyOTP);
router.post('/login-pin', loginWithPin);
router.post('/login-pin/', loginWithPin);

// Profile completion (requires authentication; optional profile_image for multipart)
router.post('/complete-profile', authenticateCustomer, upload.single('profile_image'), completeProfile);
router.post('/complete-profile/', authenticateCustomer, upload.single('profile_image'), completeProfile);

// KYC document upload (requires authentication)
router.post('/upload-kyc-document', authenticateCustomer, upload.single('document'), uploadKycDocument);
router.post('/upload-kyc-document/', authenticateCustomer, upload.single('document'), uploadKycDocument);

// Save KYC details from app (writes to Customer.kycData for Verifications screen)
router.post('/kyc-details', authenticateCustomer, saveKycDetails);
router.post('/kyc-details/', authenticateCustomer, saveKycDetails);

// Set PIN (requires authentication)
router.post('/set-pin', authenticateCustomer, setPin);
router.post('/set-pin/', authenticateCustomer, setPin);

// Get balance (requires authentication) - mobile app home screen
router.get('/balance', authenticateCustomer, getBalance);
router.get('/balance/', authenticateCustomer, getBalance);

// Get current user profile (requires authentication) - mobile app
router.get('/profile', authenticateCustomer, getProfile);
router.get('/profile/', authenticateCustomer, getProfile);

// Push notification token (requires authentication) - mobile app
router.put('/push-token', authenticateCustomer, updatePushToken);
router.put('/push-token/', authenticateCustomer, updatePushToken);

export default router;
