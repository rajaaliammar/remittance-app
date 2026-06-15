import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma.js';
import { sendInvitationEmail } from '../utils/email.js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

// Generate secure token
const generateInviteToken = () => {
  return randomBytes(32).toString('hex');
};

// Invite backoffice user
export const inviteUser = async (req, res) => {
  try {
    const { email, firstName, lastName, phone, country, city, state, address } = req.body;
    const invitedBy = req.user?.id || 'system'; // Assuming you have auth middleware

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check if user already exists
    const existingUser = await prisma.backofficeUser.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        message: 'User with this email already exists' 
      });
    }

    // Generate invite token
    const inviteToken = generateInviteToken();
    const inviteTokenExp = new Date();
    inviteTokenExp.setDate(inviteTokenExp.getDate() + 7); // 7 days expiry

    // Create backoffice user
    const user = await prisma.backofficeUser.create({
      data: {
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: phone || null,
        country: country || null,
        city: city || null,
        state: state || null,
        address: address || null,
        inviteToken,
        inviteTokenExp,
        invitedBy,
        status: 'pending'
      }
    });

    // Send invitation email
    try {
      await sendInvitationEmail(email, inviteToken, {
        firstName,
        lastName,
        phone,
        country
      });
    } catch (emailError) {
      console.error('Failed to send email:', emailError);
      // Don't fail the request if email fails, but log it
    }

    res.status(201).json({
      success: true,
      message: 'Invitation sent successfully',
      data: {
        id: user.id,
        email: user.email,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Error inviting user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get invitation details by token
export const getInvitationDetails = async (req, res) => {
  try {
    const { token } = req.params;

    const user = await prisma.backofficeUser.findUnique({
      where: { inviteToken: token }
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid or expired invitation token' 
      });
    }

    // Check if token is expired
    if (new Date() > user.inviteTokenExp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invitation token has expired' 
      });
    }

    // Check if already completed
    if (user.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Profile already completed or invitation already used' 
      });
    }

    res.json({
      success: true,
      data: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        country: user.country,
        city: user.city,
        state: user.state,
        address: user.address
      }
    });
  } catch (error) {
    console.error('Error getting invitation details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Complete profile
export const completeProfile = async (req, res) => {
  try {
    const { token } = req.params;
    const { username, firstName, lastName, phone, country, city, state, address, password, photo } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    const user = await prisma.backofficeUser.findUnique({
      where: { inviteToken: token }
    });

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid or expired invitation token' 
      });
    }

    if (new Date() > user.inviteTokenExp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invitation token has expired' 
      });
    }

    if (user.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Profile already completed' 
      });
    }

    // Check if username is already taken
    const existingUsername = await prisma.backofficeUser.findUnique({
      where: { username }
    });

    if (existingUsername && existingUsername.id !== user.id) {
      return res.status(409).json({ 
        success: false, 
        message: 'Username already taken' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user
    const updatedUser = await prisma.backofficeUser.update({
      where: { id: user.id },
      data: {
        username,
        firstName: firstName || user.firstName,
        lastName: lastName || user.lastName,
        phone: phone || user.phone,
        country: country || user.country,
        city: city || user.city,
        state: state || user.state,
        address: address || user.address,
        password: hashedPassword,
        photo: photo || user.photo,
        status: 'profile_completed',
        profileCompletedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Profile completed successfully. Waiting for admin approval.',
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        username: updatedUser.username,
        status: updatedUser.status
      }
    });
  } catch (error) {
    console.error('Error completing profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get all backoffice users
export const getAllUsers = async (req, res) => {
  try {
    const { status, search } = req.query;
    const { parsePaginationQuery, parseSortQuery, sendPaginatedJson } = await import('../utils/pagination.js');
    const pagination = parsePaginationQuery(req.query, { defaultLimit: 50, maxLimit: 200 });

    const where = {};
    if (status) {
      where.status = status;
    }
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderBy = parseSortQuery(req.query, [
      'createdAt',
      'email',
      'firstName',
      'lastName',
      'status',
    ]);

    const select = {
      id: true,
      email: true,
      username: true,
      firstName: true,
      lastName: true,
      phone: true,
      country: true,
      photo: true,
      status: true,
      isSuperAdmin: true,
      invitedAt: true,
      profileCompletedAt: true,
      approvedAt: true,
      createdAt: true,
    };

    const [users, total] = await Promise.all([
      prisma.backofficeUser.findMany({
        where,
        orderBy,
        select,
        take: pagination.take,
        skip: pagination.skip,
      }),
      prisma.backofficeUser.count({ where }),
    ]);

    // Include level & balanceLimit (via raw SQL so we get them even if Prisma schema is out of sync)
    let data = users.map((u) => ({ ...u, level: null, balanceLimit: null }));
    if (users.length > 0) {
      try {
        const ids = users.map((u) => u.id);
        const rows = await prisma.$queryRaw(
          Prisma.sql`SELECT id, "level", "balanceLimit" FROM "backoffice_users" WHERE id IN (${Prisma.join(ids)})`
        );
        const levelMap = Object.fromEntries(
          (rows || []).map((r) => [r.id, { level: r.level ?? null, balanceLimit: r.balanceLimit ?? null }])
        );
        data = users.map((u) => ({ ...u, ...levelMap[u.id] }));
      } catch {
        // Columns may not exist yet; keep nulls
      }
    }

    sendPaginatedJson(res, { data, total, pagination });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Approve user
export const approveUser = async (req, res) => {
  try {
    const { id } = req.params;
    const approvedBy = req.user?.id || 'system';

    const user = await prisma.backofficeUser.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.status !== 'profile_completed') {
      return res.status(400).json({ 
        success: false, 
        message: 'User profile must be completed before approval' 
      });
    }

    const updatedUser = await prisma.backofficeUser.update({
      where: { id },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy
      }
    });

    res.json({
      success: true,
      message: 'User approved successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Error approving user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Reject user
export const rejectUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.backofficeUser.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updatedUser = await prisma.backofficeUser.update({
      where: { id },
      data: {
        status: 'rejected'
      }
    });

    res.json({
      success: true,
      message: 'User rejected',
      data: updatedUser
    });
  } catch (error) {
    console.error('Error rejecting user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update backoffice user (level and balance limit)
export const updateBackofficeUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { level, balanceLimit } = req.body;

    const user = await prisma.backofficeUser.findUnique({
      where: { id },
      select: { id: true, email: true, username: true, firstName: true, lastName: true, phone: true, status: true, createdAt: true, updatedAt: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const levelVal = level !== undefined ? (level || null) : null;
    const balanceLimitVal = balanceLimit !== undefined ? (balanceLimit || null) : null;

    try {
      await prisma.$executeRaw(
        Prisma.sql`UPDATE "backoffice_users" SET "level" = ${levelVal}, "balanceLimit" = ${balanceLimitVal} WHERE id = ${id}`
      );
    } catch (rawErr) {
      const msg = String(rawErr?.message || '');
      if (msg.includes('column') || msg.includes('level') || msg.includes('balanceLimit') || msg.includes('does not exist')) {
        return res.status(503).json({
          success: false,
          message: 'Level and balance limit are not available yet. Restart the backend to add the required database columns.'
        });
      }
      throw rawErr;
    }

    const updatedUser = { ...user, level: levelVal, balanceLimit: balanceLimitVal };

    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser
    });
  } catch (error) {
    console.error('Error updating backoffice user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await prisma.backofficeUser.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Prevent deleting super admin
    if (user.isSuperAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot delete super admin user' 
      });
    }

    await prisma.backofficeUser.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Login
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    const trimmedUsername = typeof username === 'string' ? username.trim() : '';
    if (!trimmedUsername || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    // Case-insensitive match (emails like admIn@brandpay.com must still resolve)
    const user = await prisma.backofficeUser.findFirst({
      where: {
        OR: [
          { username: { equals: trimmedUsername, mode: 'insensitive' } },
          { email: { equals: trimmedUsername, mode: 'insensitive' } }
        ]
      }
    });

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    if (user.status !== 'approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account is not approved yet. Please wait for admin approval.' 
      });
    }

    if (!user.password) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        username: user.username,
        isSuperAdmin: user.isSuperAdmin
      },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Return user data with token
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          isSuperAdmin: user.isSuperAdmin,
          photo: user.photo
        }
      }
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

