import prisma from '../utils/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Signup - Agent registration
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
    const existingEmail = await prisma.agent.findUnique({
      where: { email }
    });

    if (existingEmail) {
      return res.status(409).json({ 
        success: false, 
        message: 'Email already registered' 
      });
    }

    // Check if username already exists
    const existingUsername = await prisma.agent.findUnique({
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

    // Create agent
    const agent = await prisma.agent.create({
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
      data: agent
    });
  } catch (error) {
    console.error('Error registering agent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Login - Agent authentication
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    // Try to find agent by username or email
    const agent = await prisma.agent.findFirst({
      where: {
        OR: [
          { username },
          { email: username }
        ]
      }
    });

    if (!agent) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (agent.status !== 'approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account is not approved yet. Please wait for admin approval.' 
      });
    }

    const isValidPassword = await bcrypt.compare(password, agent.password);

    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: agent.id,
        email: agent.email,
        username: agent.username,
        type: 'agent'
      },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Return agent data with token
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: agent.id,
          email: agent.email,
          username: agent.username,
          firstName: agent.firstName,
          lastName: agent.lastName,
          phone: agent.phone,
          type: 'agent'
        }
      }
    });
  } catch (error) {
    console.error('Error logging in agent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all agents
export const getAllAgents = async (req, res) => {
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

    const agents = await prisma.agent.findMany({
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

    res.json({ success: true, data: agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get agent by ID
export const getAgentById = async (req, res) => {
  try {
    const { id } = req.params;

    const agent = await prisma.agent.findUnique({
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

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('Error fetching agent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Approve agent
export const approveAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const approvedBy = req.user?.id || 'admin';

    const agent = await prisma.agent.findUnique({
      where: { id }
    });

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    const updatedAgent = await prisma.agent.update({
      where: { id },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy
      }
    });

    res.json({
      success: true,
      message: 'Agent approved successfully',
      data: updatedAgent
    });
  } catch (error) {
    console.error('Error approving agent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reject agent
export const rejectAgent = async (req, res) => {
  try {
    const { id } = req.params;

    const agent = await prisma.agent.findUnique({
      where: { id }
    });

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    const updatedAgent = await prisma.agent.update({
      where: { id },
      data: {
        status: 'rejected'
      }
    });

    res.json({
      success: true,
      message: 'Agent rejected',
      data: updatedAgent
    });
  } catch (error) {
    console.error('Error rejecting agent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete agent
export const deleteAgent = async (req, res) => {
  try {
    const { id } = req.params;

    const agent = await prisma.agent.findUnique({
      where: { id }
    });

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    await prisma.agent.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Agent deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting agent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

