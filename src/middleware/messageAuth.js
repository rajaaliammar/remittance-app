import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Try customer auth first, then backoffice auth. Sets req.userId for message routes.
 */
export const authenticateMessageUser = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token is required' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    const customer = await prisma.customer.findUnique({ where: { id: decoded.id }, select: { id: true } });
    if (customer) {
      req.userId = customer.id;
      req.userType = 'customer';
      return next();
    }
    const backoffice = await prisma.backofficeUser.findUnique({
      where: { id: decoded.id },
      select: { id: true, status: true },
    });
    if (backoffice && backoffice.status === 'approved') {
      req.userId = backoffice.id;
      req.userType = 'backoffice';
      return next();
    }
    return res.status(401).json({ success: false, message: 'Invalid token or user not found' });
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    if (e.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    return res.status(500).json({ success: false, message: 'Authentication error' });
  }
};
