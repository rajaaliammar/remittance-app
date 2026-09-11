import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

export const authenticateCustomer = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key-change-in-production'
    );

    const customerId = decoded.id || decoded.userId || decoded.sub;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    // Verify customer still exists using the same key signed into the JWT
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        email: true,
        username: true,
        phone: true,
        status: true,
        firstName: true,
        lastName: true
      }
    });

    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Attach customer info to request
    req.user = {
      id: customer.id,
      email: customer.email,
      username: customer.username,
      phone: customer.phone,
      type: 'customer'
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    console.error('Customer auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};
