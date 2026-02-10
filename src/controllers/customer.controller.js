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

// Complete Profile - Update customer details after OTP verification
export const completeProfile = async (req, res) => {
  try {
    const customerId = req.user?.id;
    
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const { 
      first_name,
      firstName, // Support both snake_case and camelCase
      last_name,
        lastName,
        email,
      address,
      // Registration profile fields
      date_of_birth,
      dateOfBirth,
      gender,
      nationality,
      country,
      region,
      sub_region,
      subRegion,
      city,
      // KYC fields (for later steps)
      idType,
      idNumber,
      idFrontUrl,
      idBackUrl,
      selfieUrl,
      proofOfAddressUrl
    } = req.body;

    // Update customer profile - support both snake_case and camelCase
    const updateData = {};
    if (first_name || firstName) updateData.firstName = first_name || firstName;
    if (last_name || lastName) updateData.lastName = last_name || lastName;
    if (email) updateData.email = email;
    if (address) updateData.address = address;
    
    // Store additional profile fields
    if (date_of_birth || dateOfBirth) updateData.dateOfBirth = date_of_birth || dateOfBirth;
    if (gender) updateData.gender = gender;
    if (nationality) updateData.nationality = nationality;
    if (country) updateData.country = country;
    if (region) updateData.region = region;
    if (sub_region || subRegion) updateData.subRegion = sub_region || subRegion;
    if (city) updateData.city = city;

    const updatedCustomer = await prisma.customer.update({
      where: { id: customerId },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        phone: true,
        address: true,
        dateOfBirth: true,
        gender: true,
        nationality: true,
        country: true,
        region: true,
        subRegion: true,
        city: true,
        status: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error completing profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile. Please try again.',
      error: error.message
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

