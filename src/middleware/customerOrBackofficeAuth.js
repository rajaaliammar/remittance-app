import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Accept customer or approved backoffice JWT.
 * Sets req.user with { id, type: 'customer' | 'backoffice' }.
 */
export const authenticateCustomerOrBackoffice = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token is required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id || decoded.userId || decoded.sub;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true },
    });
    if (customer) {
      req.user = { id: customer.id, email: customer.email, type: 'customer' };
      return next();
    }

    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true },
    });
    if (backoffice && backoffice.status === 'approved') {
      req.user = { id: backoffice.id, email: backoffice.email, type: 'backoffice' };
      return next();
    }

    return res.status(401).json({ success: false, message: 'Invalid token or user not found' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    console.error('Dual auth middleware error:', error);
    return res.status(500).json({ success: false, message: 'Authentication error' });
  }
};
