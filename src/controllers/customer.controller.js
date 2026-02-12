import prisma from '../utils/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/kyc';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

export const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images (JPEG, JPG, PNG) and PDF files are allowed'));
    }
  }
});

// Static OTP for development/testing
const STATIC_OTP = '123456';

/**
 * Normalize phone to canonical form for lookup.
 * Handles domestic format (e.g. 0912345678) vs international (912345678).
 * Returns [canonicalFull, altFull] - try both when looking up customer.
 */
function getPhoneLookupVariants(countryCode, phoneNumber) {
  const normalizedCountryCode = String(countryCode || '').replace(/^\+/, '').trim();
  const normalizedPhoneNumber = String(phoneNumber || '').trim().replace(/\s+/g, '');
  const fullPhone = `${normalizedCountryCode}${normalizedPhoneNumber}`;
  const nationalDigits = normalizedPhoneNumber.replace(/\D/g, '');
  const withoutLeadingZero = nationalDigits.replace(/^0+/, '') || nationalDigits;
  const altFull = `${normalizedCountryCode}${withoutLeadingZero}`;
  return [fullPhone, fullPhone !== altFull ? altFull : null];
}

// Signup - Customer registration (phone number only)
// Creates a pending customer record
export const signup = async (req, res) => {
  try {
    const { country_code, phone_number } = req.body;

      if (!country_code || phone_number == null || String(phone_number).trim() === '') {
      return res.status(400).json({ 
        success: false, 
        message: 'Country code and phone number are required.' 
      });
    }

    // Normalize phone number
    const normalizedCountryCode = String(country_code).replace(/^\+/, '');
    const normalizedPhoneNumber = String(phone_number).trim();
    const fullPhone = `${normalizedCountryCode}${normalizedPhoneNumber}`;
    const placeholderEmail = `phone_${fullPhone.replace(/\D/g, '')}@remittance.pending`;

    // Check if user already exists
      const existingByPhone = await prisma.customer.findFirst({
        where: { phone: fullPhone }
      });

      if (existingByPhone) {
      return res.status(200).json({
        success: true,
        message: 'Phone number already registered. You can proceed to verify OTP.',
        data: { 
          id: existingByPhone.id, 
          phone: existingByPhone.phone, 
          status: existingByPhone.status,
          alreadyRegistered: true
        }
      });
    }

    // Check by placeholder email
      const existingByEmail = await prisma.customer.findUnique({
        where: { email: placeholderEmail }
      });

      if (existingByEmail) {
      return res.status(200).json({
          success: true,
        message: 'Phone number already registered. You can proceed to verify OTP.',
        data: { 
          id: existingByEmail.id, 
          phone: existingByEmail.phone, 
          status: existingByEmail.status,
          alreadyRegistered: true
        }
      });
    }

    // Create new customer with pending status
      const hashedPassword = await bcrypt.hash(Math.random().toString(36) + Date.now(), 10);
      const customer = await prisma.customer.create({
        data: {
          email: placeholderEmail,
          username: `user_${fullPhone.replace(/\D/g, '')}_${Date.now()}`,
          firstName: 'Pending',
          lastName: 'User',
          phone: fullPhone,
          address: null,
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

      return res.status(201).json({
        success: true,
      message: 'Registration started. Please verify your phone number with OTP.',
      data: {
        ...customer,
        alreadyRegistered: false
      }
    });
  } catch (error) {
    console.error('Error in customer signup:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Registration failed. Please try again.',
      error: error.message 
    });
  }
};

// Send OTP - Static OTP for development
export const sendOTP = async (req, res) => {
  try {
    const { country_code, phone_number } = req.body;

    if (!country_code || !phone_number) {
      return res.status(400).json({
        success: false,
        message: 'Country code and phone number are required'
      });
    }

    // Normalize phone number
    const normalizedCountryCode = String(country_code).replace(/^\+/, '');
    const normalizedPhoneNumber = String(phone_number).trim();
    const fullPhone = `${normalizedCountryCode}${normalizedPhoneNumber}`;

    // Check if customer exists
    const customer = await prisma.customer.findFirst({
      where: { phone: fullPhone }
    });

    if (!customer) {
      return res.status(404).json({
        success: false, 
        message: 'Phone number not registered. Please sign up first.'
      });
    }

    // In development, return static OTP
    // In production, you would send actual OTP via SMS/WhatsApp
    console.log(`[OTP] Static OTP for ${fullPhone}: ${STATIC_OTP}`);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        otp: STATIC_OTP, // Only in development - remove in production
        phone: fullPhone,
        expiresIn: 300 // 5 minutes
      }
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again.',
      error: error.message
    });
  }
};

// Verify OTP
export const verifyOTP = async (req, res) => {
  try {
    const { country_code, phone_number, otp } = req.body;

    if (!country_code || !phone_number || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Country code, phone number, and OTP are required'
      });
    }

    // Normalize phone number
    const normalizedCountryCode = String(country_code).replace(/^\+/, '');
    const normalizedPhoneNumber = String(phone_number).trim();
    const fullPhone = `${normalizedCountryCode}${normalizedPhoneNumber}`;

    // Find customer
    const customer = await prisma.customer.findFirst({
      where: { phone: fullPhone }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please sign up first.'
      });
    }

    // Verify OTP (static OTP for development)
    if (otp !== STATIC_OTP) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please enter the correct OTP.'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: customer.id,
        email: customer.email,
        username: customer.username,
        phone: customer.phone,
        type: 'customer'
      },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        access_token: token,
        user: {
          id: customer.id,
          email: customer.email,
          username: customer.username,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          status: customer.status,
          type: 'customer'
        }
      }
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      message: 'OTP verification failed. Please try again.',
      error: error.message
    });
  }
};

// Login with PIN - Authenticate by phone number + 4-digit PIN (no OTP)
export const loginWithPin = async (req, res) => {
  try {
    const { country_code, phone_number, pin } = req.body;

    if (!country_code || phone_number == null || String(phone_number).trim() === '' || !pin) {
      return res.status(400).json({
        success: false,
        message: 'Country code, phone number, and PIN are required.'
      });
    }

    const [fullPhone, altPhone] = getPhoneLookupVariants(country_code, phone_number);
    const phonesToTry = [fullPhone, altPhone].filter(Boolean);
    const uniquePhones = [...new Set(phonesToTry)];

    let customer = null;
    for (const phone of uniquePhones) {
      customer = await prisma.customer.findFirst({
        where: { phone }
      });
      if (customer) break;
    }

    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Invalid PIN'
      });
    }

    if (!customer.hasPin || !customer.pin) {
      return res.status(401).json({
        success: false,
        message: 'PIN not set. Please sign in with OTP first and set a PIN.'
      });
    }

    const pinValid = await bcrypt.compare(String(pin).trim(), customer.pin);
    if (!pinValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid PIN'
      });
    }

    const token = jwt.sign(
      {
        id: customer.id,
        email: customer.email,
        username: customer.username,
        phone: customer.phone,
        type: 'customer'
      },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        access_token: token,
        user: {
          id: customer.id,
          email: customer.email,
          username: customer.username,
          first_name: customer.firstName,
          last_name: customer.lastName,
          phone: customer.phone,
          status: customer.status,
          has_pin: !!customer.hasPin,
          profile_image: null,
          type: 'customer'
        }
      }
    });
  } catch (error) {
    console.error('Error in login with PIN:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.',
      error: error.message
    });
  }
};

// Complete Profile - Update customer details after OTP verification
export const completeProfile = async (req, res) => {
  try {
    const customerId = req.user?.id;

    if (!customerId || typeof customerId !== 'string') {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const body = req.body || {};
    const {
      first_name,
      firstName,
      last_name,
      lastName,
      email,
      address,
      date_of_birth,
      dateOfBirth,
      gender,
      nationality,
      country,
      region,
      sub_region,
      subRegion,
      city
    } = body;

    // Build update payload - only include schema fields, coerce to string where needed
    const updateData = {};
    if ((first_name !== undefined && first_name !== '') || (firstName !== undefined && firstName !== '')) {
      updateData.firstName = String(first_name ?? firstName ?? '');
    }
    if ((last_name !== undefined && last_name !== '') || (lastName !== undefined && lastName !== '')) {
      updateData.lastName = String(last_name ?? lastName ?? '');
    }
    if (email !== undefined && email !== '') updateData.email = String(email);
    if (address !== undefined && address !== '') updateData.address = String(address);
    if ((date_of_birth !== undefined && date_of_birth !== '') || (dateOfBirth !== undefined && dateOfBirth !== '')) {
      const dob = date_of_birth ?? dateOfBirth;
      updateData.dateOfBirth = typeof dob === 'string' ? dob : (dob != null ? String(dob) : null);
    }
    if (gender !== undefined && gender !== '') updateData.gender = String(gender);
    if (nationality !== undefined && nationality !== '') updateData.nationality = String(nationality);
    if (country !== undefined && country !== '') updateData.country = String(country);
    if (region !== undefined && region !== '') updateData.region = String(region);
    if ((sub_region !== undefined && sub_region !== '') || (subRegion !== undefined && subRegion !== '')) {
      updateData.subRegion = String(sub_region ?? subRegion ?? '');
    }
    if (city !== undefined && city !== '') updateData.city = String(city);

    // Prisma does not accept undefined in data – remove any undefined values
    Object.keys(updateData).forEach((k) => {
      if (updateData[k] === undefined) delete updateData[k];
    });

    let updatedCustomer;
    if (Object.keys(updateData).length > 0) {
      updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: updateData
      });
    } else {
      updatedCustomer = await prisma.customer.findUnique({
        where: { id: customerId }
      });
      if (!updatedCustomer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
      }
    }

    // Never send password or pin to the client
    if (updatedCustomer) {
      delete updatedCustomer.password;
      delete updatedCustomer.pin;
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error completing profile:', error);
    const code = error?.code;
    let message = 'Failed to update profile. Please try again.';
    if (code === 'P2025') {
      message = 'Customer record not found. Please sign in again.';
    } else if (code === 'P2002') {
      message = 'This email is already in use. Please use a different email.';
    } else if (error?.message) {
      message = error.message;
    }
    res.status(500).json({
      success: false,
      message,
      ...(process.env.NODE_ENV !== 'production' && { details: { error: error?.message, code } })
    });
  }
};

// Upload KYC Document
export const uploadKycDocument = async (req, res) => {
  try {
    const customerId = req.user?.id;
    
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const { category, side } = req.body;
    const fileUrl = `/uploads/kyc/${req.file.filename}`;

    // In a real application, you would:
    // 1. Upload to cloud storage (S3, Cloudinary, etc.)
    // 2. Store the URL in database
    // 3. Associate with customer KYC record

    return res.status(200).json({
      success: true,
      message: 'KYC document uploaded successfully',
      data: {
        url: fileUrl,
        category: category || null,
        side: side || null,
        filename: req.file.filename
      }
    });
  } catch (error) {
    console.error('Error uploading KYC document:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload document. Please try again.',
      error: error.message
    });
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

// Set PIN for customer account
export const setPin = async (req, res) => {
  try {
    const { pin } = req.body;
    const customerId = req.user.id; // From authenticateCustomer middleware

    // Validate PIN
    if (!pin || typeof pin !== 'string' || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be a 4-digit number'
      });
    }

    // Hash the PIN
    const saltRounds = 10;
    const hashedPin = await bcrypt.hash(pin, saltRounds);

    // Try Prisma update first, fallback to raw SQL if Prisma client not regenerated
    let updatedCustomer;
    try {
      // Try Prisma update (will work after prisma generate)
      updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: {
          pin: hashedPin,
          hasPin: true
        },
        select: {
          id: true,
          email: true,
          username: true,
          phone: true,
          firstName: true,
          lastName: true,
          hasPin: true,
          status: true
        }
      });
    } catch (prismaError) {
      // Fallback to raw SQL if Prisma client doesn't have pin/hasPin fields yet
      if (prismaError.message && prismaError.message.includes('Unknown argument')) {
        console.log('[setPin] Using raw SQL fallback - Prisma client not regenerated yet');
        
        // Ensure columns exist first
        try {
          await prisma.$executeRawUnsafe(`
            ALTER TABLE "customers" 
            ADD COLUMN IF NOT EXISTS "pin" TEXT,
            ADD COLUMN IF NOT EXISTS "hasPin" BOOLEAN NOT NULL DEFAULT false;
          `);
        } catch (alterError) {
          // Columns might already exist, ignore error
          console.log('[setPin] Columns may already exist:', alterError.message);
        }

        // Update using raw SQL
        await prisma.$executeRawUnsafe(`
          UPDATE "customers" 
          SET "pin" = $1, "hasPin" = true, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = $2
        `, hashedPin, customerId);

        // Fetch updated customer using raw SQL
        const result = await prisma.$queryRawUnsafe(`
          SELECT 
            id, email, username, phone, 
            "firstName", "lastName", "hasPin", status
          FROM "customers"
          WHERE "id" = $1
        `, customerId);

        if (result && result.length > 0) {
          updatedCustomer = {
            id: result[0].id,
            email: result[0].email,
            username: result[0].username,
            phone: result[0].phone,
            firstName: result[0].firstName,
            lastName: result[0].lastName,
            hasPin: result[0].hasPin === true || result[0].hasPin === 'true' || result[0].hasPin === 1,
            status: result[0].status
          };
        } else {
          return res.status(404).json({
            success: false,
            message: 'Customer not found'
          });
        }
      } else {
        // Re-throw if it's a different error
        throw prismaError;
      }
    }

    res.json({
      success: true,
      message: 'PIN set successfully',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error setting PIN:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set PIN',
      error: error.message
    });
  }
};

// Get authenticated customer's available balance (for remittance app home screen)
export const getBalance = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }
    const rows = await prisma.$queryRaw`
      SELECT "availableBalance" FROM customers WHERE id = ${customerId}
    `;
    const row = rows?.[0];
    if (!row) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    const balance = row.availableBalance != null
      ? Number(row.availableBalance)
      : 12000;
    return res.json({
      success: true,
      data: {
        availableBalance: balance,
        balance,
      },
    });
  } catch (error) {
    console.error('Error getting balance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get balance',
    });
  }
};

// Get current customer profile (for mobile app GET /accounts/profile)
export const getProfile = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        status: true,
        hasPin: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    // Derive country_code and phone_number from full phone (e.g. +251912345678)
    let country_code = '';
    let phone_number = customer.phone || '';
    if (customer.phone && customer.phone.startsWith('+')) {
      const match = customer.phone.match(/^(\+\d{1,4})(.*)$/);
      if (match) {
        country_code = match[1];
        phone_number = match[2].replace(/\D/g, '').trim() || match[2];
      }
    }
    const user = {
      id: customer.id,
      email: customer.email || null,
      username: customer.username || null,
      first_name: customer.firstName || null,
      last_name: customer.lastName || null,
      phone_number,
      country_code: country_code || null,
      is_verified: customer.status === 'approved',
      has_pin: !!customer.hasPin,
      profile_image: null,
      created_at: customer.createdAt,
      updated_at: customer.updatedAt,
      type: 'customer',
    };
    return res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    console.error('Error getting profile:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get profile',
    });
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
        level: true,
        balanceLimit: true,
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
        level: true,
        balanceLimit: true,
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

// Update customer (level and balance limit)
export const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { level, balanceLimit } = req.body;

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const updatedCustomer = await prisma.customer.update({
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
      message: 'Customer updated successfully',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error updating customer:', error);
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

