import express from 'express';
import {
  signup as customerSignup,
  sendOTP,
  verifyOTP,
  loginWithPin,
  loginWithPassword,
  checkLoginInfo,
  completeProfile,
  uploadKycDocument,
  saveKycDetails,
  setPin,
  setPassword,
  getBalance,
  getProfile,
  getVerifications,
  getTierAndLimits,
  getConsumedLimits,
  getFrequentlyPaid,
  updatePushToken,
  reportDeviceInfo,
  getCustomerNotifications,
  upload,
  uploadKYC
} from '../controllers/customer.controller.js';
import { calculateCharge } from '../controllers/charge.controller.js';
import {
  customerAmlOnboard,
  customerAmlUploadDocuments,
  customerAmlSync,
} from '../controllers/aml.controller.js';
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
router.post('/login-password', loginWithPassword);
router.post('/login-password/', loginWithPassword);
router.post('/check-login-info', checkLoginInfo);
router.post('/check-login-info/', checkLoginInfo);

// Profile completion (requires authentication; optional profile_image for multipart)
router.post('/complete-profile', authenticateCustomer, upload.single('profile_image'), completeProfile);
router.post('/complete-profile/', authenticateCustomer, upload.single('profile_image'), completeProfile);

// KYC document upload (requires authentication)
router.post('/upload-kyc-document', authenticateCustomer, upload.single('document'), uploadKycDocument);
router.post('/upload-kyc-document/', authenticateCustomer, upload.single('document'), uploadKycDocument);

// Legacy KYC upload (front/back ID)
router.post('/upload-kyc', authenticateCustomer, upload.fields([
  { name: 'frontId', maxCount: 1 },
  { name: 'backId', maxCount: 1 }
]), uploadKYC);
router.post('/upload-kyc/', authenticateCustomer, upload.fields([
  { name: 'frontId', maxCount: 1 },
  { name: 'backId', maxCount: 1 }
]), uploadKYC);

// Save KYC details from app (writes to Customer.kycData for Verifications screen)
router.post('/kyc-details', authenticateCustomer, saveKycDetails);
router.post('/kyc-details/', authenticateCustomer, saveKycDetails);

// AML — mobile app compliance screen (uses KYC docs from registration)
router.post('/aml/onboard', authenticateCustomer, customerAmlOnboard);
router.post('/aml/onboard/', authenticateCustomer, customerAmlOnboard);
router.post('/aml/documents/upload', authenticateCustomer, customerAmlUploadDocuments);
router.post('/aml/documents/upload/', authenticateCustomer, customerAmlUploadDocuments);
router.post('/aml-sync', authenticateCustomer, customerAmlSync);
router.post('/aml-sync/', authenticateCustomer, customerAmlSync);

// Set PIN (requires authentication)
router.post('/set-pin', authenticateCustomer, setPin);
router.post('/set-pin/', authenticateCustomer, setPin);

// Set or update password (requires authentication) - mobile app registration flow
router.post('/set-password', authenticateCustomer, setPassword);
router.post('/set-password/', authenticateCustomer, setPassword);

// Get balance (requires authentication) - mobile app home screen
router.get('/balance', authenticateCustomer, getBalance);
router.get('/balance/', authenticateCustomer, getBalance);

// Get current user profile (requires authentication) - mobile app
router.get('/profile', authenticateCustomer, getProfile);
router.get('/profile/', authenticateCustomer, getProfile);

// Get current user's verifications/KYC documents (requires authentication) - mobile app Verifications screen
router.get('/verifications', authenticateCustomer, getVerifications);
router.get('/verifications/', authenticateCustomer, getVerifications);

// Get current user's tier and transaction limits (KYC-approved limits for remittance)
router.get('/tier-limits', authenticateCustomer, getTierAndLimits);
router.get('/tier-limits/', authenticateCustomer, getTierAndLimits);

// Get consumed (used) limits for current period - app can show remaining
router.get('/limits/consumed', authenticateCustomer, getConsumedLimits);

// Recent recipients from completed sends (Send Again on home)
router.get('/frequently-paid', authenticateCustomer, getFrequentlyPaid);
router.get('/frequently-paid/', authenticateCustomer, getFrequentlyPaid);

// Push notification token (requires authentication) - mobile app
router.put('/push-token', authenticateCustomer, updatePushToken);
router.put('/push-token/', authenticateCustomer, updatePushToken);

// Device info and location (requires authentication) - mobile app reports device/location
router.post('/device-info', authenticateCustomer, reportDeviceInfo);
router.post('/device-info/', authenticateCustomer, reportDeviceInfo);
router.put('/device-info', authenticateCustomer, reportDeviceInfo);
router.put('/device-info/', authenticateCustomer, reportDeviceInfo);

// Notifications list (requires authentication) - for in-app notifications screen
router.get('/notifications', authenticateCustomer, getCustomerNotifications);

// Charge calculation (public or authenticated)
router.post('/calculate-charge', calculateCharge);
router.post('/calculate-charge/', calculateCharge);

export default router;
