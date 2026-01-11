import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

export const authenticateToken = async (req, res, next) => {
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

    // Verify user still exists and is approved
    const user = await prisma.backofficeUser.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        username: true,
        status: true,
        isSuperAdmin: true
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not approved'
      });
    }

    // Attach user info to request
    req.user = {
      id: user.id,
      email: user.email,
      username: user.username,
      isSuperAdmin: user.isSuperAdmin
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
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

