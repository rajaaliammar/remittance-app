import prisma from '../utils/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { sendAgentInvitationEmail } from '../utils/email.js';
import { getWritableAgentKycUploadDir } from '../utils/uploadPath.js';

// Temporary in-memory store for invite tokens (until migration is run)
// TODO: Remove this after running migration - tokens will be stored in database
const inviteTokenStore = new Map(); // token -> { agentId, email, expiresAt, data }

// Temporary in-memory store for onboarding data (until migration is run)
// TODO: Remove this after running migration - onboarding data will be stored in database
const onboardingDataStore = new Map(); // agentId -> { onboardingData object }

// Temporary in-memory store for document statuses (until migration is run)
// TODO: Remove this after running migration - document statuses will be stored in database
const documentStatusStore = new Map(); // agentId -> { nationalIdFrontStatus: 'approved', ... }

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
        level: true,
        balanceLimit: true,
        createdAt: true,
        updatedAt: true,
        businessName: true
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

// Get approved agents for cash pickup (mobile app) - optionally filter by country
export const getAgentsForCashPickup = async (req, res) => {
  try {
    const { countryId } = req.query;
    const where = { status: 'approved' };

    if (countryId) {
      const country = await prisma.country.findUnique({
        where: { id: countryId },
        select: { name: true, iso2: true }
      });
      if (country) {
        // Show agents that match this country OR have no country set (so they appear for any selection)
        where.OR = [
          { country: { equals: country.name, mode: 'insensitive' } },
          { country: { equals: country.iso2, mode: 'insensitive' } },
          { country: null },
          { country: '' }
        ];
      }
    }

    const agents = await prisma.agent.findMany({
      where,
      select: {
        id: true,
        businessName: true,
        firstName: true,
        lastName: true,
        dollarRate: true,
        country: true,
        city: true,
        phone: true,
        address: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const data = agents.map((a) => ({
      id: a.id,
      name: a.businessName?.trim() || [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || a.email || 'Agent',
      dollarRate: a.dollarRate != null ? Number(a.dollarRate) : null,
      country: a.country,
      city: a.city,
      phone: a.phone,
      address: a.address
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching agents for cash pickup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get agent by ID
export const getAgentById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get all agent fields - using findUnique without select to get all fields
    // After migration, all fields will be available
    const agent = await prisma.agent.findUnique({
      where: { id }
    });

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    // TEMPORARY: Merge onboardingData from in-memory store or database JSON field into agent object for frontend
    // After migration, this won't be needed as fields will exist directly
    let agentData = { ...agent };
    
    // First, try to get onboarding data from in-memory store (temporary solution)
    let onboardingData = onboardingDataStore.get(id);
    
    // If not in memory store, try database field (after migration)
    if (!onboardingData && agent.onboardingData && typeof agent.onboardingData === 'object') {
      onboardingData = agent.onboardingData;
    }
    
    // Merge onboarding data if available
    if (onboardingData) {
      // Convert dateOfBirth from string to Date if needed
      let dobValue = agent.dateOfBirth || onboardingData.dateOfBirth;
      if (dobValue && typeof dobValue === 'string') {
        try {
          dobValue = new Date(dobValue);
        } catch (e) {
          console.warn('Failed to parse dateOfBirth:', e);
        }
      }

      // Merge onboardingData, but don't overwrite existing non-null values with null
      // Only set fields from onboardingData if they have values
      const onboardingFields = {
        dateOfBirth: agent.dateOfBirth || dobValue,
        gender: agent.gender || onboardingData.gender,
        businessName: agent.businessName || onboardingData.businessName,
        country: agent.country || onboardingData.country,
        city: agent.city || onboardingData.city,
        businessType: agent.businessType || onboardingData.businessType,
        businessLicenseNumber: agent.businessLicenseNumber || onboardingData.businessLicenseNumber,
        taxIdentification: agent.taxIdentification || onboardingData.taxIdentification,
        businessAddress: agent.businessAddress || onboardingData.businessAddress,
        commissionRate: agent.commissionRate || onboardingData.commissionRate,
        dollarRate: agent.dollarRate || onboardingData.dollarRate,
        idType: agent.idType || onboardingData.idType,
        nationalIdFront: agent.nationalIdFront || onboardingData.nationalIdFront,
        nationalIdBack: agent.nationalIdBack || onboardingData.nationalIdBack,
        passportPhoto: agent.passportPhoto || onboardingData.passportPhoto,
        businessLicenseFile: agent.businessLicenseFile || onboardingData.businessLicenseFile,
        selfiePhoto: agent.selfiePhoto || onboardingData.selfiePhoto,
        shopPhoto: agent.shopPhoto || onboardingData.shopPhoto,
        profileCompletedAt: agent.profileCompletedAt || (onboardingData.profileCompletedAt ? new Date(onboardingData.profileCompletedAt) : null)
      };

      // Only add fields that have values (not null/undefined)
      Object.keys(onboardingFields).forEach(key => {
        if (onboardingFields[key] !== null && onboardingFields[key] !== undefined) {
          agentData[key] = onboardingFields[key];
        }
      });
    }
    
    // TEMPORARY: Merge document statuses from in-memory store
    // After migration, these will be in the database
    const documentStatuses = documentStatusStore.get(id);
    if (documentStatuses) {
      // Merge document statuses into agentData
      Object.keys(documentStatuses).forEach(statusField => {
        agentData[statusField] = documentStatuses[statusField];
      });
    }
    
    // Also include document statuses from database if they exist (after migration)
    // These will override in-memory store values
    const statusFields = [
      'nationalIdFrontStatus',
      'nationalIdBackStatus',
      'passportPhotoStatus',
      'businessLicenseFileStatus',
      'selfiePhotoStatus',
      'shopPhotoStatus'
    ];
    statusFields.forEach(statusField => {
      if (agent[statusField]) {
        agentData[statusField] = agent[statusField];
      }
    });
    
    // Include onboardingData in response so frontend can access it directly if needed
    if (onboardingData) {
      agentData.onboardingData = onboardingData;
    }
    
    // Remove password from response for security
    delete agentData.password;

    res.json({ success: true, data: agentData });
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

// Approve/Reject agent document
export const updateAgentDocumentStatus = async (req, res) => {
  try {
    const { id, documentField, status } = req.params;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Use "approved" or "rejected"' });
    }

    const validFields = ['nationalIdFront', 'nationalIdBack', 'passportPhoto', 'businessLicenseFile', 'selfiePhoto', 'shopPhoto'];
    if (!validFields.includes(documentField)) {
      return res.status(400).json({ success: false, message: 'Invalid document field' });
    }

    const agent = await prisma.agent.findUnique({
      where: { id }
    });

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    // Create status field name (e.g., nationalIdFrontStatus)
    const statusField = `${documentField}Status`;
    
    // Get current onboardingData to preserve it during update
    const currentOnboardingData = agent.onboardingData || null;
    
    // Try to update the status field in database first (will work after migration)
    let updateSuccess = false;
    try {
      const updateData = {
        [statusField]: status
      };
      
      // Preserve onboardingData if it exists (important: don't lose data!)
      if (currentOnboardingData && typeof currentOnboardingData === 'object') {
        updateData.onboardingData = currentOnboardingData;
      }
      
      await prisma.agent.update({
        where: { id },
        data: updateData
      });
      updateSuccess = true;
      console.log(`[Agent Document Status] Saved to database: ${statusField} = ${status}`);
    } catch (error) {
      // If field doesn't exist, store in memory temporarily
      console.warn(`[Agent Document Status] Field ${statusField} doesn't exist yet. Using in-memory store.`);
      
      // Store in in-memory store
      let agentStatuses = documentStatusStore.get(id) || {};
      agentStatuses[statusField] = status;
      documentStatusStore.set(id, agentStatuses);
      
      // Also preserve onboardingData in memory store if it exists
      if (currentOnboardingData) {
        let onboardingData = onboardingDataStore.get(id) || {};
        // Merge current onboardingData to preserve all fields
        onboardingData = { ...onboardingData, ...currentOnboardingData };
        onboardingDataStore.set(id, onboardingData);
      }
      
      updateSuccess = true;
    }

    if (!updateSuccess) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to update document status' 
      });
    }

    res.json({
      success: true,
      message: `Document ${status} successfully`,
      data: { documentField, status, statusField }
    });
  } catch (error) {
    console.error('Error updating document status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update agent (level and balance limit)
export const updateAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const { level, balanceLimit } = req.body;

    const agent = await prisma.agent.findUnique({
      where: { id }
    });

    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }

    const updatedAgent = await prisma.agent.update({
      where: { id },
      data: {
        ...(level !== undefined && { level: level || null }),
        ...(balanceLimit !== undefined && { balanceLimit: balanceLimit || null })
      },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        status: true,
        level: true,
        balanceLimit: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      message: 'Agent updated successfully',
      data: updatedAgent
    });
  } catch (error) {
    console.error('Error updating agent:', error);
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

    await prisma.$transaction(async (tx) => {
      // Null out agent references to avoid foreign key errors (AccountingEntry, WalletBalanceSnapshot)
      await tx.accountingEntry.updateMany({ where: { agentId: id }, data: { agentId: null } });
      await tx.walletBalanceSnapshot.updateMany({ where: { agentId: id }, data: { agentId: null } });
      await tx.agent.delete({
        where: { id }
      });
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

// Generate secure token
const generateInviteToken = () => {
  return randomBytes(32).toString('hex');
};

// Invite agent
export const inviteAgent = async (req, res) => {
  try {
    const { firstName, lastName, businessName, phone, email, country, city, gender } = req.body;
    const invitedBy = req.user?.id || 'system';

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check if agent already exists
    const existingAgent = await prisma.agent.findUnique({
      where: { email }
    });

    if (existingAgent) {
      return res.status(409).json({ 
        success: false, 
        message: 'Agent with this email already exists' 
      });
    }

    // Generate invite token
    const inviteToken = generateInviteToken();
    const inviteTokenExp = new Date();
    inviteTokenExp.setDate(inviteTokenExp.getDate() + 7); // 7 days expiry

    // Generate a temporary password (required by database schema)
    // This will be replaced when agent completes onboarding
    const tempPassword = randomBytes(32).toString('hex');
    const hashedTempPassword = await bcrypt.hash(tempPassword, 10);

    // Create agent with invite details
    // NOTE: Using only fields that exist in current database schema
    // TODO: After running migration, uncomment the new fields below
    const agent = await prisma.agent.create({
      data: {
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        phone: phone || null,
        password: hashedTempPassword, // Temporary password, will be replaced during onboarding
        status: 'pending'
        // These fields will be available after migration (uncomment after running migration):
        // businessName: businessName || null,
        // country: country || null,
        // city: city || null,
        // gender: gender || null,
        // inviteToken,
        // inviteTokenExp,
        // invitedBy,
        // invitedAt: new Date(),
      }
    });
    
    // TEMPORARY: Store invite token in memory (until migration is run)
    // After migration, this will be stored in the database
    inviteTokenStore.set(inviteToken, {
      agentId: agent.id,
      email: agent.email,
      expiresAt: inviteTokenExp,
      data: {
        firstName,
        lastName,
        businessName,
        phone,
        country,
        city,
        gender
      }
    });
    
    // Clean up expired tokens periodically (every 24 hours)
    setTimeout(() => {
      const now = new Date();
      for (const [token, info] of inviteTokenStore.entries()) {
        if (info.expiresAt < now) {
          inviteTokenStore.delete(token);
        }
      }
    }, 24 * 60 * 60 * 1000);
    
    console.warn('WARNING: Using temporary in-memory token store. Run migration for persistent storage.');
    console.warn('Please run: npx prisma migrate dev --name add_agent_onboarding_fields');

    // Send invitation email
    try {
      await sendAgentInvitationEmail(email, inviteToken, {
        firstName,
        lastName,
        businessName,
        phone,
        country,
        city
      });
    } catch (emailError) {
      console.error('Failed to send email:', emailError);
      // Don't fail the request if email fails, but log it
    }

    res.status(201).json({
      success: true,
      message: 'Invitation sent successfully',
      data: {
        id: agent.id,
        email: agent.email,
        status: agent.status
      }
    });
  } catch (error) {
    console.error('Error inviting agent:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get invitation details by token
export const getInvitationDetails = async (req, res) => {
  try {
    const { token } = req.params;

    // TEMPORARY: Check in-memory store first (until migration is run)
    const tokenInfo = inviteTokenStore.get(token);
    
    if (tokenInfo) {
      // Check if token is expired
      if (new Date() > tokenInfo.expiresAt) {
        inviteTokenStore.delete(token);
        return res.status(400).json({ 
          success: false, 
          message: 'Invitation token has expired' 
        });
      }

      // Get agent from database
      const agent = await prisma.agent.findUnique({
        where: { id: tokenInfo.agentId }
      });

      if (!agent) {
        inviteTokenStore.delete(token);
        return res.status(404).json({ 
          success: false, 
          message: 'Agent not found' 
        });
      }

      // Check if already completed
      if (agent.status !== 'pending') {
        inviteTokenStore.delete(token);
        return res.status(400).json({ 
          success: false, 
          message: 'Profile already completed or invitation already used' 
        });
      }

      return res.json({
        success: true,
        data: {
          email: agent.email,
          firstName: tokenInfo.data.firstName || agent.firstName,
          lastName: tokenInfo.data.lastName || agent.lastName,
          businessName: tokenInfo.data.businessName,
          phone: tokenInfo.data.phone || agent.phone,
          country: tokenInfo.data.country,
          city: tokenInfo.data.city,
          gender: tokenInfo.data.gender
        }
      });
    }

    // Try database lookup (after migration, this will be the primary method)
    const agent = await prisma.agent.findUnique({
      where: { inviteToken: token }
    });

    if (!agent) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid or expired invitation token' 
      });
    }

    // Check if token is expired
    if (agent.inviteTokenExp && new Date() > agent.inviteTokenExp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invitation token has expired' 
      });
    }

    // Check if already completed
    if (agent.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Profile already completed or invitation already used' 
      });
    }

    res.json({
      success: true,
      data: {
        email: agent.email,
        firstName: agent.firstName,
        lastName: agent.lastName,
        businessName: agent.businessName,
        phone: agent.phone,
        country: agent.country,
        city: agent.city,
        gender: agent.gender
      }
    });
  } catch (error) {
    console.error('Error getting invitation details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Complete agent onboarding
export const completeOnboarding = async (req, res) => {
  try {
    const { token } = req.params;
    const {
      // Step 1: Personal details
      address,
      dateOfBirth,
      gender: onboardingGender,
      // Step 2: Business details
      businessType,
      businessLicenseNumber,
      taxIdentification,
      businessAddress,
      commissionRate,
      dollarRate,
      // Step 3: Uploads
      idType,
      nationalIdFront,
      nationalIdBack,
      passportPhoto,
      businessLicenseFile,
      selfiePhoto,
      shopPhoto,
      // Password
      password,
      confirmPassword
    } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Invitation token is required' });
    }

    // TEMPORARY: Check in-memory store (until migration is run)
    // After migration, tokens will be stored in database and we can query directly
    const tokenInfo = inviteTokenStore.get(token);
    
    if (!tokenInfo) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid or expired invitation token' 
      });
    }

    // Check if token is expired
    if (new Date() > tokenInfo.expiresAt) {
      inviteTokenStore.delete(token);
      return res.status(400).json({ 
        success: false, 
        message: 'Invitation token has expired' 
      });
    }

    // Get agent from database
    const agent = await prisma.agent.findUnique({
      where: { id: tokenInfo.agentId }
    });

    if (!agent) {
      inviteTokenStore.delete(token);
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid or expired invitation token' 
      });
    }

    // Check if already completed
    if (agent.status !== 'pending') {
      inviteTokenStore.delete(token);
      return res.status(400).json({ 
        success: false, 
        message: 'Profile already completed' 
      });
    }

    // Validate password
    if (!password || password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters' 
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Passwords do not match' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Parse date of birth
    let dob = null;
    if (dateOfBirth) {
      dob = new Date(dateOfBirth);
    }

    // Helper function to save base64 image to file
    const saveBase64ToFile = (base64String, filename) => {
      if (!base64String) return null;
      
      try {
        // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
        const base64Data = base64String.includes(',') 
          ? base64String.split(',')[1] 
          : base64String;
        
        const uploadDir = getWritableAgentKycUploadDir();
        const filePath = path.join(uploadDir, filename);
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true, mode: 0o755 });
        }
        
        fs.writeFileSync(filePath, buffer);
        console.log(`[Agent KYC] File saved: ${filePath}`);
        
        // Always return path relative to /uploads/agentKyc/ for static serving
        // The actual file might be in project folder or tmpdir, but URL should be consistent
        return `/uploads/agentKyc/${filename}`;
      } catch (error) {
        console.error(`[Agent KYC] Error saving file ${filename}:`, error);
        return null;
      }
    };

    // Save all document images to files
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    let savedNationalIdFront = null;
    let savedNationalIdBack = null;
    let savedPassportPhoto = null;
    let savedBusinessLicenseFile = null;
    let savedSelfiePhoto = null;
    let savedShopPhoto = null;

    if (nationalIdFront) {
      const filename = `nationalIdFront-${uniqueSuffix}.jpg`;
      savedNationalIdFront = saveBase64ToFile(nationalIdFront, filename);
    }

    if (nationalIdBack) {
      const filename = `nationalIdBack-${uniqueSuffix}.jpg`;
      savedNationalIdBack = saveBase64ToFile(nationalIdBack, filename);
    }

    if (passportPhoto) {
      const filename = `passport-${uniqueSuffix}.jpg`;
      savedPassportPhoto = saveBase64ToFile(passportPhoto, filename);
    }

    if (businessLicenseFile) {
      const filename = `businessLicense-${uniqueSuffix}.jpg`;
      savedBusinessLicenseFile = saveBase64ToFile(businessLicenseFile, filename);
    }

    if (selfiePhoto) {
      const filename = `selfie-${uniqueSuffix}.jpg`;
      savedSelfiePhoto = saveBase64ToFile(selfiePhoto, filename);
    }

    if (shopPhoto) {
      const filename = `shop-${uniqueSuffix}.jpg`;
      savedShopPhoto = saveBase64ToFile(shopPhoto, filename);
    }

    // Save all onboarding data directly to database fields
    // All fields exist in the schema, so we save them directly
    const inviteData = tokenInfo?.data || {};
    
    // Build updateData with only fields that exist in current database schema
    // Start with basic fields that always exist
    const updateData = {
      address: address || agent.address,
      password: hashedPassword,
      status: 'profile_completed'
    };
    
    // Try to add commissionRate if it exists in schema
    if (commissionRate) {
      try {
        updateData.commissionRate = parseFloat(commissionRate);
      } catch (e) {
        console.warn('Failed to parse commissionRate:', e);
      }
    }
    
    // Try to add dollarRate if it exists in schema
    // Note: This will only work after running migration: npx prisma migrate dev --name add_agent_dollar_rate
    if (dollarRate != null) {
      try {
        // Only add if field exists in schema (will be caught in try-catch below if not)
        updateData.dollarRate = parseFloat(dollarRate);
      } catch (e) {
        console.warn('Failed to parse dollarRate:', e);
        // Remove from updateData if parsing failed
        delete updateData.dollarRate;
      }
    }
    
    // Store all onboarding data in JSON field as backup (for fields that don't exist yet)
    const onboardingData = {
      // Include invite data
      businessName: inviteData.businessName || agent.businessName || null,
      country: inviteData.country || agent.country || null,
      city: inviteData.city || agent.city || null,
      gender: onboardingGender || inviteData.gender || agent.gender || null,
      // Onboarding-specific data
      dateOfBirth: dob,
      businessType,
      businessLicenseNumber,
      taxIdentification,
      businessAddress,
      commissionRate: commissionRate ? parseFloat(commissionRate) : null,
      dollarRate: dollarRate ? parseFloat(dollarRate) : null,
      idType,
      nationalIdFront: savedNationalIdFront,
      nationalIdBack: savedNationalIdBack,
      passportPhoto: savedPassportPhoto,
      businessLicenseFile: savedBusinessLicenseFile,
      selfiePhoto: savedSelfiePhoto,
      shopPhoto: savedShopPhoto,
      profileCompletedAt: new Date().toISOString()
    };
    
    // Try to save onboardingData to database JSON field
    try {
      updateData.onboardingData = onboardingData;
    } catch (e) {
      // If onboardingData field doesn't exist, store in memory
      console.warn('onboardingData field not available, using in-memory store');
      if (tokenInfo && tokenInfo.agentId) {
        onboardingDataStore.set(tokenInfo.agentId, onboardingData);
      }
    }

    // Try to update with all fields, but catch errors for fields that don't exist yet
    let updatedAgent;
    try {
      updatedAgent = await prisma.agent.update({
        where: { id: tokenInfo.agentId },
        data: updateData
      });
    } catch (updateError) {
      // If update fails due to unknown fields (like dollarRate not migrated yet), try with only basic fields
      const errorMessage = updateError.message || '';
      const isUnknownFieldError = errorMessage.includes('Unknown argument') || errorMessage.includes('dollarRate');
      
      if (isUnknownFieldError) {
        console.warn('Update failed due to unknown field (likely dollarRate not migrated yet), trying with basic fields only:', updateError.message);
        // Remove dollarRate from updateData if it caused the error
        if (updateData.dollarRate !== undefined) {
          delete updateData.dollarRate;
          console.log('Removed dollarRate from updateData, will save to onboardingData instead');
        }
        
        // Try again without dollarRate
        try {
          updatedAgent = await prisma.agent.update({
            where: { id: tokenInfo.agentId },
            data: updateData
          });
        } catch (retryError) {
          // If still fails, use minimal update
          console.warn('Retry also failed, using minimal update:', retryError.message);
          const basicUpdateData = {
            address: address || agent.address,
            password: hashedPassword,
            status: 'profile_completed'
          };
          
          // Try to add commissionRate if it exists
          if (commissionRate) {
            try {
              basicUpdateData.commissionRate = parseFloat(commissionRate);
            } catch (e) {}
          }
          
          updatedAgent = await prisma.agent.update({
            where: { id: tokenInfo.agentId },
            data: basicUpdateData
          });
          
          // Save all other data to onboardingData JSON field or in-memory store
          try {
            await prisma.agent.update({
              where: { id: tokenInfo.agentId },
              data: { onboardingData: onboardingData }
            });
            console.log('Onboarding data saved to database JSON field');
          } catch (dbError) {
            // If onboardingData field doesn't exist, store in memory
            console.warn('onboardingData field not available, using in-memory store');
            if (tokenInfo && tokenInfo.agentId) {
              onboardingDataStore.set(tokenInfo.agentId, onboardingData);
            }
          }
        }
      } else {
        // Different error, re-throw
        throw updateError;
      }
    }
    
    // Save onboardingData to JSON field if not already saved (for successful updates)
    if (updatedAgent && onboardingData) {
      try {
        await prisma.agent.update({
          where: { id: tokenInfo.agentId },
          data: { onboardingData: onboardingData }
        });
        console.log('Onboarding data saved to database JSON field');
      } catch (dbError) {
        // If onboardingData field doesn't exist, store in memory
        console.warn('onboardingData field not available, using in-memory store');
        if (tokenInfo && tokenInfo.agentId) {
          onboardingDataStore.set(tokenInfo.agentId, onboardingData);
        }
      }
    }

    // Remove token from in-memory store after successful onboarding
    if (tokenInfo && tokenInfo.agentId) {
      inviteTokenStore.delete(token);
    }

    // Merge onboarding data into response
    let responseData = { ...updatedAgent };
    if (onboardingData) {
      responseData = {
        ...responseData,
        ...onboardingData
      };
    }
    
    // Remove password from response for security
    delete responseData.password;

    res.json({
      success: true,
      message: 'Onboarding completed successfully! Your profile is pending admin approval.',
      data: responseData
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
