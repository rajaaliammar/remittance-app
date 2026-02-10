import express from 'express';
import { 
  signup, 
  login, 
  getAllCustomers, 
  getCustomerById, 
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

// Protected routes (require authentication)
router.get('/', authenticateToken, getAllCustomers);
router.get('/:id', authenticateToken, getCustomerById);
router.patch('/:id', authenticateToken, updateCustomer);
router.post('/approve/:id', authenticateToken, approveCustomer);
router.post('/reject/:id', authenticateToken, rejectCustomer);
router.delete('/:id', authenticateToken, deleteCustomer);

export default router;

