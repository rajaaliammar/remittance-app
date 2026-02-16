import prisma from '../utils/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getWritableKycUploadDir } from '../utils/uploadPath.js';

// Fallback dir that is always available (tmpdir) so uploads never fail with EACCES
const TMPDIR_KYC = path.join(os.tmpdir(), 'remittance-kyc-uploads', 'kyc');

// Configure multer for file uploads (uses writable dir; never passes EACCES to client)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadDir;
    try {
      uploadDir = getWritableKycUploadDir();
      console.log('[KYC Upload] Upload destination:', uploadDir);
    } catch (err) {
      console.warn('[KYC Upload] getWritableKycUploadDir failed, using tmpdir:', err?.message);
      try {
        if (!fs.existsSync(TMPDIR_KYC)) {
          fs.mkdirSync(TMPDIR_KYC, { recursive: true, mode: 0o755 });
        }
        uploadDir = TMPDIR_KYC;
        console.log('[KYC Upload] Fallback destination:', uploadDir);
      } catch (e) {
        console.error('[KYC Upload] tmpdir fallback failed:', e);
        return cb(e);
      }
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
 * Returns array of variants to try when looking up customer.
 */
function getPhoneLookupVariants(countryCode, phoneNumber) {
  const normalizedCountryCode = String(countryCode || '').replace(/^\+/, '').trim();
  const normalizedPhoneNumber = String(phoneNumber || '').trim().replace(/\s+/g, '');
  const fullPhone = `${normalizedCountryCode}${normalizedPhoneNumber}`;
  const nationalDigits = normalizedPhoneNumber.replace(/\D/g, '');
  const withoutLeadingZero = nationalDigits.replace(/^0+/, '') || nationalDigits;
  const altFull = `${normalizedCountryCode}${withoutLeadingZero}`;
  // When app sends national without leading 0 (e.g. 912345678), DB may store 2510912345678
  const withLeadingZero = withoutLeadingZero ? `${normalizedCountryCode}0${withoutLeadingZero}` : null;
  const variants = [fullPhone, fullPhone !== altFull ? altFull : null, withLeadingZero].filter(Boolean);
  return [...new Set(variants)];
}

// Signup - Customer registration (phone number + password)
// Creates a pending customer record; password is required for new signups.
export const signup = async (req, res) => {
  try {
    const { country_code, phone_number, password } = req.body;

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

    // New signup: password is required (min 6 characters)
    if (!password || typeof password !== 'string' || String(password).trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 6 characters.'
      });
    }
    const hashedPassword = await bcrypt.hash(String(password).trim(), 10);

    // Create new customer with pending status
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

    const phonesToTry = getPhoneLookupVariants(country_code, phone_number);

    let customer = null;
    for (const phone of phonesToTry) {
      customer = await prisma.customer.findFirst({
        where: { phone }
      });
      if (customer) break;
    }

    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Account not found. Please sign in with OTP first or check your phone number.'
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

// Check login info - Returns whether user has PIN set (so app can show Password vs PIN screen).
// No auth required; used on login screen when user enters phone.
export const checkLoginInfo = async (req, res) => {
  try {
    const { country_code, phone_number } = req.body;

    if (!country_code || phone_number == null || String(phone_number).trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Country code and phone number are required.'
      });
    }

    const phonesToTry = getPhoneLookupVariants(country_code, phone_number);
    let customer = null;
    for (const phone of phonesToTry) {
      customer = await prisma.customer.findFirst({
        where: { phone },
        select: { id: true, hasPin: true }
      });
      if (customer) break;
    }

    if (!customer) {
      return res.status(200).json({
        success: true,
        data: { hasPin: false, exists: false }
      });
    }

    return res.status(200).json({
      success: true,
      data: { hasPin: !!customer.hasPin, exists: true }
    });
  } catch (error) {
    console.error('Error in checkLoginInfo:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check login info.',
      error: error.message
    });
  }
};

// Login with password - First-time or no-PIN login (phone + password).
export const loginWithPassword = async (req, res) => {
  try {
    const { country_code, phone_number, password } = req.body;

    if (!country_code || phone_number == null || String(phone_number).trim() === '' || !password) {
      return res.status(400).json({
        success: false,
        message: 'Country code, phone number, and password are required.'
      });
    }

    const phonesToTry = getPhoneLookupVariants(country_code, phone_number);
    let customer = null;
    for (const phone of phonesToTry) {
      customer = await prisma.customer.findFirst({
        where: { phone }
      });
      if (customer) break;
    }

    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Account not found. Please sign up first.'
      });
    }

    const passwordValid = await bcrypt.compare(String(password).trim(), customer.password);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password.'
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
    console.error('Error in login with password:', error);
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

// Upload KYC Document (Single file)
export const uploadKycDocument = async (req, res) => {
  try {
    const customerId = req.user?.id;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if file exists and is valid
    if (!req.file) {
      console.error('[KYC Upload] No file received in request');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a valid image or document.'
      });
    }

    // Validate file properties
    if (!req.file.filename || !req.file.path) {
      console.error('[KYC Upload] Invalid file object:', req.file);
      return res.status(400).json({
        success: false,
        message: 'Invalid file. Please try uploading again.'
      });
    }

    // Check file size (multer already limits to 10MB, but add extra validation)
    if (req.file.size === 0) {
      console.error('[KYC Upload] Empty file received');
      return res.status(400).json({
        success: false,
        message: 'File is empty. Please upload a valid file.'
      });
    }

    const { category, side } = req.body;
    const fileUrl = `/uploads/kyc/${req.file.filename}`;

    console.log(`[KYC Upload] ✅ File uploaded successfully for customer ${customerId}:`, {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      category: category || 'N/A'
    });

    // Return the URL so the app can use it in subsequent KYC submission calls
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
    console.error('[KYC Upload] ❌ Error uploading KYC document:', error);
    console.error('[KYC Upload] Error details:', {
      message: error.message,
      stack: error.stack,
      customerId: req.user?.id
    });
    
    // Provide more specific error messages
    let errorMessage = 'Failed to upload document. Please try again.';
    if (error.code === 'LIMIT_FILE_SIZE') {
      errorMessage = 'File is too large. Maximum size is 10MB.';
    } else if (error.message && error.message.includes('file type')) {
      errorMessage = 'Invalid file type. Please upload an image (JPEG, PNG) or PDF.';
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

// Upload National ID (Front and Back) - Used by legacy app flow
export const uploadKYC = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!req.files || (!req.files.frontId && !req.files.backId)) {
      return res.status(400).json({ success: false, message: 'ID images are required' });
    }

    const frontIdFile = req.files.frontId ? req.files.frontId[0] : null;
    const backIdFile = req.files.backId ? req.files.backId[0] : null;

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { kycData: true }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    let kycData = customer.kycData ? (Array.isArray(customer.kycData) ? customer.kycData : [customer.kycData]) : [];

    const now = new Date().toISOString();
    const documents = [];

    if (frontIdFile) {
      documents.push({
        id: `field_front_${Date.now()}`,
        fieldName: 'National ID Front',
        inputType: 'file',
        value: frontIdFile.filename,
        fileUrl: `/uploads/kyc/${frontIdFile.filename}`,
        status: 'pending'
      });
    }

    if (backIdFile) {
      documents.push({
        id: `field_back_${Date.now()}`,
        fieldName: 'National ID Back',
        inputType: 'file',
        value: backIdFile.filename,
        fileUrl: `/uploads/kyc/${backIdFile.filename}`,
        status: 'pending'
      });
    }

    const newDoc = {
      id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      verificationType: 'National ID',
      formName: 'National ID',
      status: 'pending',
      submittedAt: now,
      date: now,
      documents: documents
    };

    kycData.push(newDoc);

    await prisma.customer.update({
      where: { id: customerId },
      data: { kycData }
    });

    return res.status(200).json({
      success: true,
      message: 'KYC documents uploaded successfully',
      data: newDoc
    });
  } catch (error) {
    console.error('Error uploading KYC:', error);
    res.status(500).json({ success: false, message: 'Failed to upload documents', error: error.message });
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

// Get current customer's verification/KYC documents (for app Verifications screen)
// Same data as GET /kyc/my-documents - reads from Customer.kycData
export const getVerifications = async (req, res) => {
  try {
    const customerId = req.user?.id;
    console.log('[getVerifications] ========== START ==========');
    console.log('[getVerifications] Customer ID from token:', customerId);
    console.log('[getVerifications] Full req.user:', JSON.stringify(req.user, null, 2));

    if (!customerId) {
      console.log('[getVerifications] ❌ No customer ID - returning 401');
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        kycData: true
      },
    });

    console.log('[getVerifications] Customer found:', !!customer);
    if (customer) {
      console.log('[getVerifications] Customer details:', {
        id: customer.id,
        name: `${customer.firstName} ${customer.lastName}`,
        phone: customer.phone,
        email: customer.email,
        hasKycData: customer.kycData != null,
        kycDataType: typeof customer.kycData,
        kycDataIsArray: Array.isArray(customer.kycData)
      });
    }

    if (!customer) {
      console.log('[getVerifications] ❌ Customer not found in database');
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    let raw = customer.kycData;
    console.log('[getVerifications] Raw kycData:', JSON.stringify(raw, null, 2));

    if (typeof raw === 'string') {
      console.log('[getVerifications] kycData is string, attempting to parse...');
      try {
        raw = JSON.parse(raw);
        console.log('[getVerifications] ✅ Parsed successfully');
      } catch (e) {
        console.log('[getVerifications] ❌ Failed to parse JSON:', e.message);
        raw = null;
      }
    }

    const kycDocuments = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    console.log('[getVerifications] Final kycDocuments count:', kycDocuments.length);
    console.log('[getVerifications] Final kycDocuments:', JSON.stringify(kycDocuments, null, 2));
    console.log('[getVerifications] ========== END ==========');

    return res.json({
      success: true,
      data: kycDocuments,
      message: 'Verifications retrieved successfully',
    });
  } catch (error) {
    console.error('[getVerifications] ❌ ERROR:', error);
    console.error('[getVerifications] Error stack:', error.stack);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch verifications',
    });
  }
};

// Save KYC details from app (EnhancedKYCScreen / multi-step flow) into Customer.kycData so Verifications screen shows real data
export const saveKycDetails = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }
    const body = req.body || {};
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { kycData: true },
    });
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }
    let kycData = customer.kycData ? (Array.isArray(customer.kycData) ? customer.kycData : [customer.kycData]) : [];
    const originalLength = kycData.length;
    const now = new Date().toISOString();
    if (body.enhancedKYC && typeof body.enhancedKYC === 'object') {
      const fields = [];
      Object.entries(body.enhancedKYC).forEach(([key, value]) => {
        if (value != null && value !== '') {
          fields.push({
            id: `field_${key}_${Date.now()}`,
            fieldName: key,
            inputType: 'text',
            value: typeof value === 'string' ? value : JSON.stringify(value),
            fileUrl: typeof value === 'string' && value.startsWith('http') ? value : null,
            status: 'pending',
            verifiedAt: null,
            verifiedBy: null,
          });
        }
      });
      kycData.push({
        id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        verificationType: 'Enhanced KYC',
        formName: 'Enhanced KYC',
        country: body.country || 'USD',
        status: 'pending',
        submittedAt: now,
        date: now,
        documents: fields,
      });
    }
    if ((body.verificationType || body.formName) && !body.enhancedKYC) {
      const vType = body.verificationType || body.formName;
      const existing = kycData.find(d => (d.verificationType || d.formName) === vType);
      if (!existing) {
        kycData.push({
          id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          verificationType: vType,
          formName: vType,
          country: body.country || 'USD',
          status: 'pending',
          submittedAt: now,
          date: now,
          documents: body.fields && Array.isArray(body.fields) ? body.fields : [],
        });
      }
    }
    if (kycData.length === originalLength) {
      return res.json({
        success: true,
        message: 'KYC details received',
        data: kycData,
      });
    }
    await prisma.customer.update({
      where: { id: customerId },
      data: { kycData },
    });
    return res.json({
      success: true,
      message: 'KYC details saved successfully',
      data: kycData,
    });
  } catch (error) {
    console.error('Error saving KYC details:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to save KYC details',
    });
  }
};

// Update FCM push token for the authenticated customer (mobile app)
export const updatePushToken = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      });
    }
    await prisma.customer.update({
      where: { id: customerId },
      data: { fcmToken: token.trim() },
    });
    return res.json({
      success: true,
      message: 'Push token updated',
    });
  } catch (error) {
    console.error('Error updating push token:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update push token',
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

