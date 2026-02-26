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
  updateCustomer,
  approveCustomer, 
  rejectCustomer, 
  deleteCustomer 
} from '../controllers/customer.controller.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/signup', signup);
router.post('/login', login);
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// Protected routes (require authentication)
router.get('/', authenticateToken, getAllCustomers);
router.get('/device-info-by-email', authenticateToken, getCustomerDeviceInfoByEmail);
router.get('/:id', authenticateToken, getCustomerById);
router.post('/:id/send-notification', authenticateToken, sendNotificationToCustomer);
router.patch('/:id', authenticateToken, updateCustomer);
router.post('/approve/:id', authenticateToken, approveCustomer);
router.post('/reject/:id', authenticateToken, rejectCustomer);
router.delete('/:id', authenticateToken, deleteCustomer);

export default router;

