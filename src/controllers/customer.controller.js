import prisma from '../utils/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Signup - Customer registration
export const signup = async (req, res) => {
  try {
    const { firstName, lastName, username, email, phone, address, password, confirmPassword } = req.body;

    if (!firstName || !lastName || !username || !email || !phone || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'All required fields must be filled' 
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Passwords do not match' 
      });
    }

    // Check if email already exists
    const existingEmail = await prisma.customer.findUnique({
      where: { email }
    });

    if (existingEmail) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already registered' 
      });
    }

    // Check if username already exists
    const existingUsername = await prisma.customer.findUnique({
      where: { username }
    });

    if (existingUsername) {
      return res.status(409).json({ 
        success: false, 
        message: 'Username already taken' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create customer
    const customer = await prisma.customer.create({
      data: {
        firstName,
        lastName,
        username,
        email,
        phone,
        address: address || null,
        password: hashedPassword,
        status: 'pending'
      },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        status: true,
        createdAt: true
      }
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful! Your account is pending admin approval.',
      data: customer
    });
  } catch (error) {
    console.error('Error registering customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Login - Customer authentication
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    // Try to find customer by username or email
    const customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { username },
          { email: username }
        ]
      }
    });

    if (!customer) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (customer.status !== 'approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account is not approved yet. Please wait for admin approval.' 
      });
    }

    const isValidPassword = await bcrypt.compare(password, customer.password);

    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: customer.id,
        email: customer.email,
        username: customer.username,
        type: 'customer'
      },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Return customer data with token
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: customer.id,
          email: customer.email,
          username: customer.username,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          type: 'customer'
        }
      }
    });
  } catch (error) {
    console.error('Error logging in customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all customers
export const getAllCustomers = async (req, res) => {
  try {
    const { search } = req.query;
    
    const where = search ? {
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } }
      ]
    } : {};

    const customers = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        status: true,
        approvedAt: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({ success: true, data: customers });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get customer by ID
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        status: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Approve customer
export const approveCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const approvedBy = req.user?.id || 'admin';

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy
      }
    });

    res.json({
      success: true,
      message: 'Customer approved successfully',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error approving customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reject customer
export const rejectCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: {
        status: 'rejected'
      }
    });

    res.json({
      success: true,
      message: 'Customer rejected',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error rejecting customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete customer
export const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    await prisma.customer.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

