import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';

/** Attach customer from Bearer when present; never fails for missing token. */
export const optionalAuthenticateCustomer = async (req, _res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    );

    const customer = await prisma.customer.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        username: true,
        phone: true,
        status: true,
        firstName: true,
        lastName: true,
      },
    });

    if (customer) {
      req.user = {
        id: customer.id,
        email: customer.email,
        username: customer.username,
        phone: customer.phone,
        type: 'customer',
      };
    }
  } catch {
    // ignore
  }
  return next();
};
