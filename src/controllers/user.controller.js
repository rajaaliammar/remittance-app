import prisma from '../utils/prisma.js';

// Get all users
export const getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get user by ID
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create new user
export const createUser = async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await prisma.user.create({
      data: {
        email,
        name
      }
    });

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    console.error('Error creating user:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Email already exists' });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Update user
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(email && { email }),
        ...(name !== undefined && { name })
      }
    });

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Error updating user:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Email already exists' });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.user.delete({
      where: { id }
    });

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(500).json({ success: false, error: error.message });
  }
};

