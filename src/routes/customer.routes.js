import express from 'express';
import { 
  signup, 
  login, 
  sendOTP,
  verifyOTP,
  getAllCustomers, 
  getCustomerById,
  getCustomerDeviceInfoByEmail,
  sendNotificationToCustomer,
  broadcastNotificationToAllCustomers,
  updateCustomer,
  approveCustomer, 
  rejectCustomer, 
  deleteCustomer 
} from '../controllers/customer.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  getCustomerAmlStatus,
  runCustomerAmlValidation,
  getCustomerAmlCached,
  onboardCustomerToAml,
  clearCustomerAmlCase,
  getCustomerAmlDocuments,
  uploadCustomerAmlDocuments,
  previewCustomerAmlDocuments,
} from '../controllers/aml.controller.js';
import {
  getCustomerLiveexCached,
  refreshCustomerLiveexDetails,
  runCustomerLiveexOnboarding,
} from '../controllers/liveexOnboarding.controller.js';

const router = express.Router();

// Public routes
router.post('/signup', signup);
router.post('/login', login);
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// Protected routes (require authentication)
router.get('/', authenticateToken, getAllCustomers);
router.post('/broadcast-notification', authenticateToken, broadcastNotificationToAllCustomers);
router.get('/device-info-by-email', authenticateToken, getCustomerDeviceInfoByEmail);
router.get('/:id/aml/cached', authenticateToken, getCustomerAmlCached);
router.get('/:id/aml/status', authenticateToken, getCustomerAmlStatus);
router.get('/:id/aml/documents', authenticateToken, getCustomerAmlDocuments);
router.get('/:id/aml/documents/preview', authenticateToken, previewCustomerAmlDocuments);
router.post('/:id/aml/documents/upload', authenticateToken, uploadCustomerAmlDocuments);
router.post('/:id/aml/validate', authenticateToken, runCustomerAmlValidation);
router.post('/:id/aml/onboard', authenticateToken, onboardCustomerToAml);
router.post('/:id/aml/case-clear', authenticateToken, clearCustomerAmlCase);
router.get('/:id/liveex/cached', authenticateToken, getCustomerLiveexCached);
router.post('/:id/liveex/details', authenticateToken, refreshCustomerLiveexDetails);
router.post('/:id/liveex/run', authenticateToken, runCustomerLiveexOnboarding);
router.get('/:id', authenticateToken, getCustomerById);
router.post('/:id/send-notification', authenticateToken, sendNotificationToCustomer);
router.patch('/:id', authenticateToken, updateCustomer);
router.post('/approve/:id', authenticateToken, approveCustomer);
router.post('/reject/:id', authenticateToken, rejectCustomer);
router.delete('/:id', authenticateToken, deleteCustomer);

export default router;

