import prisma from '../utils/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  persistMulterFile,
  resolvePublicFileUrl,
} from '../utils/objectStorage.js';
import { upload, uploadNotificationImageMulter, uploadCountryServiceImageMulter } from '../utils/uploadMulter.js';
export { upload, uploadNotificationImageMulter, uploadCountryServiceImageMulter };
import {
  getCustomerLimits,
  getNextLevelForCustomer,
  ensureCustomerLevelAssigned,
  buildTierLimitsForApp,
  getSentInPeriod,
  getApprovedKYCMaxAmount,
  getMinimumActiveKycMaxAmount,
  getActiveKycMaxAmountForCustomer,
  getSubmittedKycMaxAmount,
  startOfDayUTC,
  startOfWeekUTC,
  startOfMonthUTC,
} from '../utils/limitsHelper.js';
import { resolveCustomerFcmToken, sendPushToToken, getPushConfigStatus } from '../utils/push.js';
import { notifyCustomerAsync, deliverCustomerNotification } from '../utils/customerNotify.js';
import { emitCustomersUpdated } from '../utils/portalNotify.js';
import { extractClientIp } from '../utils/clientIp.js';
import {
  buildClientIpFields,
  resolveLastIpForApi,
} from '../utils/resolveCustomerLastIp.js';
import { tryApprovePendingCustomerFromCachedStatus } from '../utils/amlAutoApprove.js';
import { generateOtpCode, saveOtp, consumeOtp, hasOtp } from '../utils/otpStore.js';
import { isSmtpConfigured, sendVerificationOtpEmail } from '../utils/email.js';

/** Phone signup OTP is a fixed code. Email recovery OTP uses SMTP only (not LiveEx). */
const STATIC_PHONE_OTP = String(process.env.PHONE_OTP_STATIC_CODE || '1234').trim();

function isStaticPhoneOtp(otp) {
  return String(otp || '').trim() === STATIC_PHONE_OTP;
}

function signCustomerAccessToken(customer) {
  return jwt.sign(
    {
      id: customer.id,
      email: customer.email,
      username: customer.username,
      phone: customer.phone,
      type: 'customer',
    },
    process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function customerAuthPayload(customer, extra = {}) {
  return {
    access_token: signCustomerAccessToken(customer),
    user: {
      id: customer.id,
      email: customer.email || null,
      username: customer.username || null,
      first_name: customer.firstName || null,
      middle_name: customer.middleName || null,
      last_name: customer.lastName || null,
      phone: customer.phone,
      status: customer.status,
      has_pin: !!customer.hasPin,
      type: 'customer',
      ...extra,
    },
  };
}

/**
 * Forgot password / Forgot PIN only — our SMTP (never LiveEx).
 * Signup uses phone + static OTP; identity (name/DOB/email) is saved via complete-profile.
 */
async function deliverRecoveryEmailOtp({ email, purpose, title, subject }) {
  const emailTrimmed = String(email || '').trim().toLowerCase();

  if (!isSmtpConfigured()) {
    const err = new Error(
      'OTP email delivery is not configured. Set SMTP_USER and SMTP_PASS (and SMTP_DISABLED=false).'
    );
    err.status = 503;
    err.code = 'OTP_DELIVERY_UNAVAILABLE';
    throw err;
  }

  const code = generateOtpCode(6);
  saveOtp('email', emailTrimmed, code);
  await sendVerificationOtpEmail(emailTrimmed, code, {
    purpose: purpose || 'reset your account access',
    title: title || 'Account verification',
    subject: subject || 'Your account verification code',
  });
  return { channel: 'smtp', email: emailTrimmed };
}

async function verifyRecoveryEmailOtp(email, otp) {
  const emailTrimmed = String(email || '').trim().toLowerCase();
  const code = String(otp || '').trim();

  if (!hasOtp('email', emailTrimmed)) {
    const err = new Error('Invalid or expired OTP. Please request a new code.');
    err.status = 400;
    throw err;
  }

  if (!consumeOtp('email', emailTrimmed, code)) {
    const err = new Error('Invalid OTP. Please enter the correct OTP.');
    err.status = 400;
    throw err;
  }
  return true;
}

/**
 * Normalize phone to canonical form for lookup.
 * Handles domestic format (e.g. 0912345678) vs international (912345678).
 * Returns array of variants to try when looking up customer.
 * MUST match the format used in signup (digits only, no spaces/dashes).
 */
function getPhoneLookupVariants(countryCode, phoneNumber) {
  // Normalize country code - remove + prefix and trim
  const normalizedCountryCode = String(countryCode || '').replace(/^\+/, '').trim();
  // Remove ALL non-digit characters to match signup format exactly
  const nationalDigits = String(phoneNumber || '').trim().replace(/\D/g, '');
  
  if (!normalizedCountryCode || !nationalDigits) {
    return [];
  }
  
  // Generate variants
  const variants = [];
  
  // 1. Full phone with leading zero (if present)
  const fullPhone = `${normalizedCountryCode}${nationalDigits}`;
  variants.push(fullPhone);
  
  // 2. Without leading zero
  const withoutLeadingZero = nationalDigits.replace(/^0+/, '') || nationalDigits;
  if (withoutLeadingZero !== nationalDigits) {
    variants.push(`${normalizedCountryCode}${withoutLeadingZero}`);
  }
  
  // 3. With leading zero (if not already present)
  if (!nationalDigits.startsWith('0') && withoutLeadingZero) {
    variants.push(`${normalizedCountryCode}0${withoutLeadingZero}`);
  }
  
  // Remove duplicates and return
  return [...new Set(variants)];
}

const EXTENDED_PROFILE_KEYS = [
  'middleName',
  'telephone',
  'unitApt',
  'zipCode',
  'placeOfBirth',
  'occupation',
  'sourceOfFund',
  'residentCountry',
];

const splitExtendedProfileData = (data = {}) => {
  const baseData = {};
  const extendedData = {};

  Object.entries(data).forEach(([key, value]) => {
    if (EXTENDED_PROFILE_KEYS.includes(key)) {
      extendedData[key] = value;
    } else {
      baseData[key] = value;
    }
  });

  return { baseData, extendedData };
};

const ensureCustomerExtendedProfileColumns = async () => {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "customers"
    ADD COLUMN IF NOT EXISTS "middleName" TEXT,
    ADD COLUMN IF NOT EXISTS "telephone" TEXT,
    ADD COLUMN IF NOT EXISTS "unitApt" TEXT,
    ADD COLUMN IF NOT EXISTS "zipCode" TEXT,
    ADD COLUMN IF NOT EXISTS "placeOfBirth" TEXT,
    ADD COLUMN IF NOT EXISTS "occupation" TEXT,
    ADD COLUMN IF NOT EXISTS "sourceOfFund" TEXT,
    ADD COLUMN IF NOT EXISTS "residentCountry" TEXT,
    ADD COLUMN IF NOT EXISTS "profileImage" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "customers"
    ADD COLUMN IF NOT EXISTS "lastDeviceInfo" JSONB,
    ADD COLUMN IF NOT EXISTS "lastLocation" JSONB,
    ADD COLUMN IF NOT EXISTS "lastIpAddress" TEXT,
    ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMPTZ;
  `);
};

const applyExtendedProfileRawUpdate = async (customerId, extendedData = {}) => {
  const entries = Object.entries(extendedData).filter(([, v]) => v !== undefined);
  if (!customerId || entries.length === 0) return;

  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  entries.forEach(([key, value]) => {
    setClauses.push(`"${key}" = $${paramIndex}`);
    values.push(value);
    paramIndex += 1;
  });

  setClauses.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  values.push(customerId);

  const query = `UPDATE "customers" SET ${setClauses.join(', ')} WHERE "id" = $${paramIndex}`;
  await prisma.$executeRawUnsafe(query, ...values);
};

// Signup step 1: phone only (email/name come later on complete-profile).
// Creates a pending customer with a placeholder email until identity is submitted.
export const signup = async (req, res) => {
  try {
    await ensureCustomerExtendedProfileColumns();

    const {
      country_code,
      phone_number,
      password,
      first_name,
      firstName,
      middle_name,
      middleName,
      last_name,
      lastName,
      email,
      address,
      telephone,
      unit_apt,
      unitApt,
      zip_code,
      zipCode,
      gender,
      date_of_birth,
      dateOfBirth,
      nationality,
      place_of_birth,
      placeOfBirth,
      occupation,
      source_of_fund,
      sourceOfFund,
      resident_country,
      residentCountry,
      country,
      region,
      sub_region,
      subRegion,
      city
    } = req.body;

    if (!country_code || phone_number == null || String(phone_number).trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Country code and phone number are required.'
      });
    }

    // Normalize phone number - MUST match login format exactly
    // Remove + from country code and trim
    const normalizedCountryCode = String(country_code || '').replace(/^\+/, '').trim();
    // Remove all non-digit characters from phone number (spaces, dashes, etc.) to match login format
    const normalizedPhoneNumber = String(phone_number || '').trim().replace(/\D/g, '');
    
    if (!normalizedCountryCode || !normalizedPhoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Country code and phone number are required.'
      });
    }
    
    const fullPhone = `${normalizedCountryCode}${normalizedPhoneNumber}`;
    const placeholderEmail = `phone_${fullPhone}@remittance.pending`;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const resolvedFirstName = String(first_name ?? firstName ?? '').trim();
    const resolvedMiddleName = String(middle_name ?? middleName ?? '').trim();
    const resolvedLastName = String(last_name ?? lastName ?? '').trim();
    const resolvedAddress = typeof address === 'string' ? address.trim() : '';
    const resolvedTelephone = typeof telephone === 'string' ? telephone.trim() : '';
    const resolvedUnitApt = String(unit_apt ?? unitApt ?? '').trim();
    const resolvedZipCode = String(zip_code ?? zipCode ?? '').trim();
    const resolvedDob = String(date_of_birth ?? dateOfBirth ?? '').trim();
    const resolvedNationality = typeof nationality === 'string' ? nationality.trim() : '';
    const resolvedPlaceOfBirth = String(place_of_birth ?? placeOfBirth ?? '').trim();
    const resolvedOccupation = typeof occupation === 'string' ? occupation.trim() : '';
    const resolvedSourceOfFund = String(source_of_fund ?? sourceOfFund ?? '').trim();
    const resolvedResidentCountry = String(resident_country ?? residentCountry ?? '').trim();
    const resolvedCountry = typeof country === 'string' ? country.trim() : '';
    const resolvedRegion = typeof region === 'string' ? region.trim() : '';
    const resolvedSubRegion = String(sub_region ?? subRegion ?? '').trim();
    const resolvedCity = typeof city === 'string' ? city.trim() : '';

    // Optional profile fields that can be attached during signup as well.
    const buildOptionalProfileUpdate = () => {
      const data = {};
      if (resolvedFirstName) data.firstName = resolvedFirstName;
      if (resolvedMiddleName) data.middleName = resolvedMiddleName;
      if (resolvedLastName) data.lastName = resolvedLastName;
      if (resolvedTelephone) data.telephone = resolvedTelephone;
      if (resolvedUnitApt) data.unitApt = resolvedUnitApt;
      if (resolvedZipCode) data.zipCode = resolvedZipCode;
      if (resolvedAddress) data.address = resolvedAddress;
      if (gender != null && String(gender).trim() !== '') data.gender = String(gender).trim();
      if (date_of_birth != null && String(date_of_birth).trim() !== '') {
        data.dateOfBirth = String(date_of_birth).trim().slice(0, 10);
      } else if (resolvedDob) {
        data.dateOfBirth = resolvedDob.slice(0, 10);
      }
      if (resolvedNationality) data.nationality = resolvedNationality;
      if (resolvedPlaceOfBirth) data.placeOfBirth = resolvedPlaceOfBirth;
      if (resolvedOccupation) data.occupation = resolvedOccupation;
      if (resolvedSourceOfFund) data.sourceOfFund = resolvedSourceOfFund;
      if (resolvedResidentCountry) data.residentCountry = resolvedResidentCountry;
      if (resolvedCountry) data.country = resolvedCountry;
      if (resolvedRegion) data.region = resolvedRegion;
      if (resolvedSubRegion) data.subRegion = resolvedSubRegion;
      if (resolvedCity) data.city = resolvedCity;
      return data;
    };

    // Check if user already exists
    const existingByPhone = await prisma.customer.findFirst({
      where: { phone: fullPhone }
    });

    if (existingByPhone) {
      const updateData = buildOptionalProfileUpdate();
      const { baseData, extendedData } = splitExtendedProfileData(updateData);
      if (Object.keys(baseData).length > 0) {
        await prisma.customer.update({
          where: { id: existingByPhone.id },
          data: baseData,
        });
      }
      await applyExtendedProfileRawUpdate(existingByPhone.id, extendedData);
      emitCustomersUpdated(req);
      return res.status(200).json({
        success: true,
        message: 'Phone number already registered. You can proceed to verify OTP.',
        data: {
          id: existingByPhone.id,
          phone: existingByPhone.phone,
          status: existingByPhone.status,
          alreadyRegistered: true,
          next_step: 'verify_otp',
          signup_flow: 'phone_otp_identity',
        }
      });
    }

    if (normalizedEmail) {
      const existingByProvidedEmail = await prisma.customer.findUnique({
        where: { email: normalizedEmail }
      });
      if (existingByProvidedEmail) {
        return res.status(409).json({
          success: false,
          message: 'Email already registered. Please use another email or login.',
        });
      }
    }

    // Check by placeholder email
    const existingByEmail = normalizedEmail
      ? null
      : await prisma.customer.findUnique({
          where: { email: placeholderEmail }
        });

    if (existingByEmail) {
      const updateData = buildOptionalProfileUpdate();
      const { baseData, extendedData } = splitExtendedProfileData(updateData);
      if (Object.keys(baseData).length > 0) {
        await prisma.customer.update({
          where: { id: existingByEmail.id },
          data: baseData,
        });
      }
      await applyExtendedProfileRawUpdate(existingByEmail.id, extendedData);
      emitCustomersUpdated(req);
      return res.status(200).json({
        success: true,
        message: 'Phone number already registered. You can proceed to verify OTP.',
        data: {
          id: existingByEmail.id,
          phone: existingByEmail.phone,
          status: existingByEmail.status,
          alreadyRegistered: true,
          next_step: 'verify_otp',
          signup_flow: 'phone_otp_identity',
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

    const createData = {
      email: normalizedEmail || placeholderEmail,
      username: `user_${fullPhone.replace(/\D/g, '')}_${Date.now()}`,
      firstName: resolvedFirstName || 'Pending',
      lastName: resolvedLastName || 'User',
      phone: fullPhone,
      address: resolvedAddress || null,
      password: hashedPassword,
      status: 'pending'
    };
    if (resolvedMiddleName) createData.middleName = resolvedMiddleName;
    if (resolvedTelephone) createData.telephone = resolvedTelephone;
    if (resolvedUnitApt) createData.unitApt = resolvedUnitApt;
    if (resolvedZipCode) createData.zipCode = resolvedZipCode;
    if (gender != null && String(gender).trim() !== '') {
      createData.gender = String(gender).trim();
    }
    if (date_of_birth != null && String(date_of_birth).trim() !== '') {
      createData.dateOfBirth = String(date_of_birth).trim().slice(0, 10);
    } else if (resolvedDob) {
      createData.dateOfBirth = resolvedDob.slice(0, 10);
    }
    if (resolvedNationality) createData.nationality = resolvedNationality;
    if (resolvedPlaceOfBirth) createData.placeOfBirth = resolvedPlaceOfBirth;
    if (resolvedOccupation) createData.occupation = resolvedOccupation;
    if (resolvedSourceOfFund) createData.sourceOfFund = resolvedSourceOfFund;
    if (resolvedResidentCountry) createData.residentCountry = resolvedResidentCountry;
    if (resolvedCountry) createData.country = resolvedCountry;
    if (resolvedRegion) createData.region = resolvedRegion;
    if (resolvedSubRegion) createData.subRegion = resolvedSubRegion;
    if (resolvedCity) createData.city = resolvedCity;

    // Create new customer with pending status
    const { baseData: baseCreateData, extendedData: extendedCreateData } = splitExtendedProfileData(createData);
    const customer = await prisma.customer.create({
      data: baseCreateData,
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
    await applyExtendedProfileRawUpdate(customer.id, extendedCreateData);
    const signupIp = extractClientIp(req);
    if (signupIp) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { lastIpAddress: signupIp, lastSeenAt: new Date() },
      }).catch(() => {});
    }
    emitCustomersUpdated(req);

    return res.status(201).json({
      success: true,
      message: 'Registration started. Verify your phone with OTP, then add your name, date of birth, and email.',
      data: {
        ...customer,
        alreadyRegistered: false,
        next_step: 'verify_otp',
        signup_flow: 'phone_otp_identity',
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

// Send OTP
// - email body  → Forgot password / Forgot PIN only (SMTP, never LiveEx)
// - phone body  → Signup step 2 (static code; no LiveEx, email not required)
export const sendOTP = async (req, res) => {
  try {
    const { country_code, phone_number, email } = req.body;
    const emailTrimmed = email != null ? String(email).trim().toLowerCase() : '';

    // ——— Forgot password / Forgot PIN (SMTP only) ———
    if (emailTrimmed) {
      const customer = await prisma.customer.findFirst({
        where: { email: { equals: emailTrimmed, mode: 'insensitive' } },
      });
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'No account found for this email. Please sign up first.',
        });
      }
      try {
        await deliverRecoveryEmailOtp({
          email: emailTrimmed,
          purpose: 'reset your account access',
          title: 'Account verification',
          subject: 'Your account verification code',
        });
      } catch (err) {
        console.error('[OTP] Failed to send recovery email OTP:', err);
        return res.status(err.status || 502).json({
          success: false,
          message:
            err.message ||
            'Failed to send verification email. Please try again.',
          code: err.code,
        });
      }
      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        data: {
          email: emailTrimmed,
          expiresIn: 300,
          channel: 'smtp',
          purpose: 'recovery',
        },
      });
    }

    if (!country_code || !phone_number) {
      return res.status(400).json({
        success: false,
        message: 'Country code and phone number, or email, are required',
      });
    }

    const normalizedCountryCode = String(country_code || '')
      .replace(/^\+/, '')
      .trim();
    const normalizedPhoneNumber = String(phone_number || '')
      .trim()
      .replace(/\D/g, '');

    if (!normalizedCountryCode || !normalizedPhoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Country code and phone number are required',
      });
    }

    const fullPhone = `${normalizedCountryCode}${normalizedPhoneNumber}`;

    const customer = await prisma.customer.findFirst({
      where: { phone: fullPhone },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not registered. Please sign up first.',
      });
    }

    const deliveryEmail = String(customer.email || '').trim().toLowerCase();
    const hasRealEmail =
      deliveryEmail.includes('@') && !deliveryEmail.endsWith('@remittance.pending');

    // Phone signup OTP is static — do not require email and do not call LiveEx.
    console.log(`[OTP] Phone verification ready for ${fullPhone} (static code)`);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        phone: fullPhone,
        ...(hasRealEmail
          ? { emailHint: deliveryEmail.replace(/(.{2}).+(@.+)/, '$1***$2') }
          : {}),
        expiresIn: 300,
        channel: 'static',
        next_step: 'verify_otp',
        signup_flow: 'phone_otp_identity',
      },
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again.',
      error: error.message,
    });
  }
};

// Verify OTP
// - email → Forgot password / Forgot PIN (SMTP store)
// - phone → Signup step 2 (static code; next app screen is name / DOB / email)
export const verifyOTP = async (req, res) => {
  try {
    const { country_code, phone_number, otp, email } = req.body;
    const emailTrimmed = email != null ? String(email).trim().toLowerCase() : '';

    // ——— Forgot password / Forgot PIN ———
    if (emailTrimmed) {
      if (!otp) {
        return res.status(400).json({
          success: false,
          message: 'Email and OTP are required',
        });
      }
      const customer = await prisma.customer.findFirst({
        where: { email: { equals: emailTrimmed, mode: 'insensitive' } },
      });
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'User not found. Please sign up first.',
        });
      }
      try {
        await verifyRecoveryEmailOtp(emailTrimmed, otp);
      } catch (err) {
        return res.status(err.status || 400).json({
          success: false,
          message: err.message || 'Invalid OTP. Please enter the correct OTP.',
        });
      }
      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully',
        data: customerAuthPayload(customer),
      });
    }

    if (!country_code || !phone_number || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Country code, phone number, and OTP are required',
      });
    }

    const normalizedCountryCode = String(country_code || '')
      .replace(/^\+/, '')
      .trim();
    const normalizedPhoneNumber = String(phone_number || '')
      .trim()
      .replace(/\D/g, '');

    if (!normalizedCountryCode || !normalizedPhoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Country code, phone number, and OTP are required',
      });
    }

    const fullPhone = `${normalizedCountryCode}${normalizedPhoneNumber}`;

    const customer = await prisma.customer.findFirst({
      where: { phone: fullPhone },
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please sign up first.',
      });
    }

    // Phone OTP is static. Identity (name, DOB, email) is collected after this.
    if (!isStaticPhoneOtp(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please enter the correct OTP.',
      });
    }

    let derivedCountryCode = '';
    let derivedPhoneNumber = customer.phone || '';
    if (customer.phone && customer.phone.startsWith('+')) {
      const match = customer.phone.match(/^(\+\d{1,4})(.*)$/);
      if (match) {
        derivedCountryCode = match[1];
        derivedPhoneNumber = match[2].replace(/\D/g, '').trim() || match[2];
      }
    } else {
      derivedCountryCode = `+${normalizedCountryCode}`;
      derivedPhoneNumber = normalizedPhoneNumber;
    }

    const io = req.app?.get?.('io');
    notifyCustomerAsync(
      customer.id,
      {
        title: customer.hasPin ? 'Signed in' : 'Phone verified',
        body: customer.hasPin
          ? 'You are signed in to OneZaPay.'
          : 'Continue registration to finish setting up your account.',
        data: {
          type: 'security',
          screen: customer.hasPin ? 'home' : 'register',
        },
      },
      io
    );

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        access_token: signCustomerAccessToken(customer),
        user: {
          id: customer.id,
          email: customer.email || null,
          username: customer.username || null,
          first_name: customer.firstName || null,
          last_name: customer.lastName || null,
          phone: customer.phone,
          phone_number: derivedPhoneNumber,
          country_code: derivedCountryCode || null,
          status: customer.status,
          is_verified: customer.status === 'approved',
          has_pin: !!customer.hasPin,
          profile_image: null,
          registration_complete: !!(
            customer.firstName &&
            customer.lastName &&
            customer.hasPin
          ),
          created_at: customer.createdAt,
          updated_at: customer.updatedAt,
          type: 'customer',
        },
        next_step: 'identity',
        signup_flow: 'phone_otp_identity',
      },
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      message: 'OTP verification failed. Please try again.',
      error: error.message,
    });
  }
};

// Login with PIN - Authenticate by phone number + PIN or email + PIN (no OTP)
export const loginWithPin = async (req, res) => {
  try {
    const { country_code, phone_number, email, pin } = req.body;
    const emailTrimmed = email != null ? String(email).trim().toLowerCase() : '';

    if (emailTrimmed !== '') {
      if (!pin) {
        return res.status(400).json({
          success: false,
          message: 'Email and PIN are required.'
        });
      }
      const customer = await prisma.customer.findFirst({
        where: { email: emailTrimmed }
      });
      if (!customer) {
        return res.status(401).json({
          success: false,
          message: 'Account not found. Please sign in with password first or check your email.'
        });
      }
      if (!customer.pin) {
        return res.status(401).json({
          success: false,
          message: 'PIN not set. Please sign in with password first and set a PIN.'
        });
      }
      const pinValid = await bcrypt.compare(String(pin).trim(), customer.pin);
      if (!pinValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid PIN'
        });
      }
      // Ensure hasPin flag is set (fixes cases where pin was set but hasPin wasn't persisted)
      const loginIpData = { lastSeenAt: new Date() };
      const loginIp = extractClientIp(req);
      if (loginIp) loginIpData.lastIpAddress = loginIp;
      if (!customer.hasPin) loginIpData.hasPin = true;
      await prisma.customer.update({
        where: { id: customer.id },
        data: loginIpData,
      }).catch(() => {});
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
      const io = req.app?.get?.('io');
      notifyCustomerAsync(
        customer.id,
        {
          title: 'Signed in',
          body: 'Welcome back to OneZaPay.',
          data: { type: 'security', screen: 'home' },
        },
        io
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
            has_pin: true,
            profile_image: null,
            type: 'customer'
          }
        }
      });
    }

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

    if (!customer.pin) {
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

    // Ensure hasPin flag is set + capture IP
    const phonePinIpData = { lastSeenAt: new Date() };
    const phonePinIp = extractClientIp(req);
    if (phonePinIp) phonePinIpData.lastIpAddress = phonePinIp;
    if (!customer.hasPin) phonePinIpData.hasPin = true;
    await prisma.customer.update({
      where: { id: customer.id },
      data: phonePinIpData,
    }).catch(() => {});

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

    const io = req.app?.get?.('io');
    notifyCustomerAsync(
      customer.id,
      {
        title: 'Signed in',
        body: 'Welcome back to OneZaPay.',
        data: { type: 'security', screen: 'home' },
      },
      io
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
          has_pin: true,
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
// No auth required; accepts either (country_code + phone_number) or email.
export const checkLoginInfo = async (req, res) => {
  try {
    const { country_code, phone_number, email } = req.body;
    const emailTrimmed = email != null ? String(email).trim() : '';

    if (emailTrimmed !== '') {
      // Lookup by email (case-insensitive)
      const customer = await prisma.customer.findFirst({
        where: {
          email: { equals: emailTrimmed.toLowerCase(), mode: 'insensitive' },
        },
        select: { id: true, hasPin: true }
      });
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
    }

    if (!country_code || phone_number == null || String(phone_number).trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Country code and phone number, or email, are required.'
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

// Login with password - First-time or no-PIN login (phone + password or email + password).
export const loginWithPassword = async (req, res) => {
  try {
    const { country_code, phone_number, email, password } = req.body;
    const emailTrimmed = email != null ? String(email).trim().toLowerCase() : '';

    if (emailTrimmed !== '') {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required.'
        });
      }
      const customer = await prisma.customer.findFirst({
        where: { email: emailTrimmed }
      });
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
      const emailPwIp = extractClientIp(req);
      await prisma.customer.update({
        where: { id: customer.id },
        data: { lastSeenAt: new Date(), ...(emailPwIp ? { lastIpAddress: emailPwIp } : {}) },
      }).catch(() => {});
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
    }

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

    const phonePwIp = extractClientIp(req);
    await prisma.customer.update({
      where: { id: customer.id },
      data: { lastSeenAt: new Date(), ...(phonePwIp ? { lastIpAddress: phonePwIp } : {}) },
    }).catch(() => {});

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
    await ensureCustomerExtendedProfileColumns();

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
      middle_name,
      middleName,
      last_name,
      lastName,
      email,
      address,
      telephone,
      unit_apt,
      unitApt,
      zip_code,
      zipCode,
      date_of_birth,
      dateOfBirth,
      gender,
      nationality,
      place_of_birth,
      placeOfBirth,
      occupation,
      source_of_fund,
      sourceOfFund,
      resident_country,
      residentCountry,
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
    if ((middle_name !== undefined && middle_name !== '') || (middleName !== undefined && middleName !== '')) {
      updateData.middleName = String(middle_name ?? middleName ?? '');
    }
    if ((last_name !== undefined && last_name !== '') || (lastName !== undefined && lastName !== '')) {
      updateData.lastName = String(last_name ?? lastName ?? '');
    }
    if (email !== undefined && email !== '') {
      updateData.email = String(email).trim().toLowerCase();
    }
    if (telephone !== undefined && telephone !== '') updateData.telephone = String(telephone);
    if ((unit_apt !== undefined && unit_apt !== '') || (unitApt !== undefined && unitApt !== '')) {
      updateData.unitApt = String(unit_apt ?? unitApt ?? '');
    }
    if ((zip_code !== undefined && zip_code !== '') || (zipCode !== undefined && zipCode !== '')) {
      updateData.zipCode = String(zip_code ?? zipCode ?? '');
    }
    if (address !== undefined && address !== '') updateData.address = String(address);
    if ((date_of_birth !== undefined && date_of_birth !== '') || (dateOfBirth !== undefined && dateOfBirth !== '')) {
      const dob = date_of_birth ?? dateOfBirth;
      const raw = typeof dob === 'string' ? dob : (dob != null ? String(dob) : '');
      updateData.dateOfBirth = raw ? raw.trim().slice(0, 10) : null;
    }
    if (gender !== undefined && gender !== '') updateData.gender = String(gender);
    if (nationality !== undefined && nationality !== '') updateData.nationality = String(nationality);
    if ((place_of_birth !== undefined && place_of_birth !== '') || (placeOfBirth !== undefined && placeOfBirth !== '')) {
      updateData.placeOfBirth = String(place_of_birth ?? placeOfBirth ?? '');
    }
    if (occupation !== undefined && occupation !== '') updateData.occupation = String(occupation);
    if ((source_of_fund !== undefined && source_of_fund !== '') || (sourceOfFund !== undefined && sourceOfFund !== '')) {
      updateData.sourceOfFund = String(source_of_fund ?? sourceOfFund ?? '');
    }
    if ((resident_country !== undefined && resident_country !== '') || (residentCountry !== undefined && residentCountry !== '')) {
      updateData.residentCountry = String(resident_country ?? residentCountry ?? '');
    }
    if (country !== undefined && country !== '') updateData.country = String(country);
    if (region !== undefined && region !== '') updateData.region = String(region);
    if ((sub_region !== undefined && sub_region !== '') || (subRegion !== undefined && subRegion !== '')) {
      updateData.subRegion = String(sub_region ?? subRegion ?? '');
    }
    if (city !== undefined && city !== '') updateData.city = String(city);

    // Profile photo (multipart field profile_image)
    let profileImageUrl = null;
    if (req.file) {
      const stored = await persistMulterFile(req.file, 'kyc', {
        filenamePrefix: 'profile_image',
      });
      profileImageUrl = stored?.url ?? null;
      if (profileImageUrl) {
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "customers" SET "profileImage" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
            profileImageUrl,
            customerId
          );
        } catch (rawErr) {
          console.warn('[completeProfile] profileImage raw update failed, trying Prisma:', rawErr?.message);
          updateData.profileImage = profileImageUrl;
        }
      }
    }

    // Prisma does not accept undefined in data – remove any undefined values
    Object.keys(updateData).forEach((k) => {
      if (updateData[k] === undefined) delete updateData[k];
    });
    // Already persisted via raw SQL when possible
    delete updateData.profileImage;

    const { baseData, extendedData } = splitExtendedProfileData(updateData);

    let updatedCustomer;
    if (Object.keys(baseData).length > 0) {
      updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: baseData
      });
      await applyExtendedProfileRawUpdate(customerId, extendedData);
    } else if (Object.keys(extendedData).length > 0) {
      await applyExtendedProfileRawUpdate(customerId, extendedData);
      updatedCustomer = await prisma.customer.findUnique({
        where: { id: customerId }
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

    let profileImage = profileImageUrl;
    if (!profileImage && updatedCustomer) {
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT "profileImage" FROM "customers" WHERE "id" = $1 LIMIT 1`,
          customerId
        );
        profileImage = rows?.[0]?.profileImage ?? updatedCustomer.profileImage ?? null;
      } catch {
        profileImage = updatedCustomer.profileImage ?? null;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        ...updatedCustomer,
        profile_image: profileImage,
      },
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

// Portal admin: upload notification image (returns URL for use in send-notification)
export const uploadNotificationImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    }
    const stored = await persistMulterFile(req.file, 'notifications', {
      filenamePrefix: 'notification',
    });
    const url = resolvePublicFileUrl(stored?.url);
    res.json({ success: true, url });
  } catch (error) {
    console.error('Error uploading notification image:', error);
    res.status(500).json({ success: false, message: error?.message || 'Upload failed.' });
  }
};

// Portal admin: upload country service display image (store returned path on CountryService.displayImage)
export const uploadCountryServiceImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded.' });
    }
    const stored = await persistMulterFile(req.file, 'country-services', {
      filenamePrefix: 'country-service',
    });
    const url = resolvePublicFileUrl(stored?.url);
    res.json({ success: true, url });
  } catch (error) {
    console.error('Error uploading country service image:', error);
    res.status(500).json({ success: false, message: error?.message || 'Upload failed.' });
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
    if (!req.file.buffer && !req.file.path) {
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
    const stored = await persistMulterFile(req.file, 'kyc');
    const fileUrl = resolvePublicFileUrl(stored?.url);

    console.log(`[KYC Upload] ✅ File uploaded successfully for customer ${customerId}:`, {
      filename: stored?.filename,
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
        filename: stored?.filename
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
      const storedFront = await persistMulterFile(frontIdFile, 'kyc', {
        filenamePrefix: 'frontId',
      });
      documents.push({
        id: `field_front_${Date.now()}`,
        fieldName: 'National ID Front',
        inputType: 'file',
        value: storedFront?.filename,
        fileUrl: resolvePublicFileUrl(storedFront?.url),
        status: 'pending'
      });
    }

    if (backIdFile) {
      const storedBack = await persistMulterFile(backIdFile, 'kyc', {
        filenamePrefix: 'backId',
      });
      documents.push({
        id: `field_back_${Date.now()}`,
        fieldName: 'National ID Back',
        inputType: 'file',
        value: storedBack?.filename,
        fileUrl: resolvePublicFileUrl(storedBack?.url),
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

/** Load hashed PIN for the authenticated customer (Prisma with raw SQL fallback). */
async function getCustomerPinRecord(customerId) {
  try {
    return await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, pin: true, hasPin: true },
    });
  } catch (prismaError) {
    if (!prismaError.message?.includes('Unknown argument')) throw prismaError;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, pin, "hasPin" FROM "customers" WHERE "id" = $1 LIMIT 1`,
      customerId
    );
    if (!rows?.length) return null;
    const row = rows[0];
    return {
      id: row.id,
      pin: row.pin ?? null,
      hasPin: row.hasPin === true || row.hasPin === 'true' || row.hasPin === 1,
    };
  }
}

/** Persist a new hashed PIN (Prisma with raw SQL fallback). */
async function updateCustomerPinHash(customerId, hashedPin) {
  try {
    return await prisma.customer.update({
      where: { id: customerId },
      data: { pin: hashedPin, hasPin: true },
      select: {
        id: true,
        email: true,
        username: true,
        phone: true,
        firstName: true,
        lastName: true,
        hasPin: true,
        status: true,
      },
    });
  } catch (prismaError) {
    if (!prismaError.message?.includes('Unknown argument')) throw prismaError;
    await prisma.$executeRawUnsafe(
      `
        ALTER TABLE "customers"
        ADD COLUMN IF NOT EXISTS "pin" TEXT,
        ADD COLUMN IF NOT EXISTS "hasPin" BOOLEAN NOT NULL DEFAULT false;
      `
    );
    await prisma.$executeRawUnsafe(
      `
        UPDATE "customers"
        SET "pin" = $1, "hasPin" = true, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $2
      `,
      hashedPin,
      customerId
    );
    const result = await prisma.$queryRawUnsafe(
      `
        SELECT id, email, username, phone, "firstName", "lastName", "hasPin", status
        FROM "customers"
        WHERE "id" = $1
      `,
      customerId
    );
    if (!result?.length) return null;
    const row = result[0];
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      phone: row.phone,
      firstName: row.firstName,
      lastName: row.lastName,
      hasPin: row.hasPin === true || row.hasPin === 'true' || row.hasPin === 1,
      status: row.status,
    };
  }
}

function validateFourDigitPin(pin, label) {
  if (!pin || typeof pin !== 'string' || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    return `${label} must be a 4-digit number`;
  }
  return null;
}

/**
 * Change PIN for authenticated customer (mobile app Settings → Change PIN).
 * POST /api/accounts/change-pin
 */
export const changePin = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { currentPin, newPin } = req.body || {};
    const currentErr = validateFourDigitPin(currentPin, 'Current PIN');
    if (currentErr) {
      return res.status(400).json({ success: false, message: currentErr });
    }
    const newErr = validateFourDigitPin(newPin, 'New PIN');
    if (newErr) {
      return res.status(400).json({ success: false, message: newErr });
    }
    if (String(currentPin) === String(newPin)) {
      return res.status(400).json({
        success: false,
        message: 'New PIN must be different from your current PIN',
      });
    }

    const customer = await getCustomerPinRecord(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (!customer.pin) {
      return res.status(400).json({
        success: false,
        message: 'No PIN is set on this account. Use set PIN during registration instead.',
      });
    }

    const currentValid = await bcrypt.compare(String(currentPin).trim(), customer.pin);
    if (!currentValid) {
      return res.status(401).json({ success: false, message: 'Current PIN is incorrect' });
    }

    const saltRounds = 10;
    const hashedPin = await bcrypt.hash(String(newPin).trim(), saltRounds);
    const updatedCustomer = await updateCustomerPinHash(customerId, hashedPin);
    if (!updatedCustomer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    return res.json({
      success: true,
      message: 'PIN updated successfully',
      data: updatedCustomer,
    });
  } catch (error) {
    console.error('[changePin] error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to change PIN',
    });
  }
};

// Set password for authenticated customer
export const setPassword = async (req, res) => {
  try {
    const { password } = req.body;
    const customerId = req.user.id; // From authenticateCustomer middleware

    // Validate password (minimum 6 characters)
    if (!password || typeof password !== 'string' || String(password).trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password is required and must be at least 6 characters'
      });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(String(password).trim(), saltRounds);

    // Update customer password
    let updatedCustomer;
    try {
      updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: {
          password: hashedPassword
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
      // Fallback to raw SQL if needed
      if (prismaError.message && prismaError.message.includes('Unknown argument')) {
        console.log('[setPassword] Using raw SQL fallback');
        
        // Update using raw SQL
        await prisma.$executeRawUnsafe(`
          UPDATE "customers" 
          SET "password" = $1, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = $2
        `, hashedPassword, customerId);

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
        throw prismaError;
      }
    }

    res.json({
      success: true,
      message: 'Password set successfully',
      data: updatedCustomer
    });
  } catch (error) {
    console.error('Error setting password:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set password',
      error: error.message
    });
  }
};

/**
 * Change password for authenticated customer (mobile app Settings → Change password).
 * POST /api/accounts/change-password
 */
export const changePassword = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const { currentPassword, newPassword } = req.body || {};
    const current = currentPassword != null ? String(currentPassword).trim() : '';
    const next = newPassword != null ? String(newPassword).trim() : '';

    if (!current || current.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Current password is required and must be at least 6 characters',
      });
    }
    if (!next || next.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password is required and must be at least 6 characters',
      });
    }
    if (current === next) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from your current password',
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, password: true },
    });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (!customer.password) {
      return res.status(400).json({
        success: false,
        message: 'No password is set on this account yet.',
      });
    }

    const currentValid = await bcrypt.compare(current, customer.password);
    if (!currentValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(next, saltRounds);

    let updatedCustomer;
    try {
      updatedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: { password: hashedPassword },
        select: {
          id: true,
          email: true,
          username: true,
          phone: true,
          firstName: true,
          lastName: true,
          hasPin: true,
          status: true,
        },
      });
    } catch (prismaError) {
      if (!prismaError.message?.includes('Unknown argument')) throw prismaError;
      await prisma.$executeRawUnsafe(
        `UPDATE "customers" SET "password" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $2`,
        hashedPassword,
        customerId
      );
      const result = await prisma.$queryRawUnsafe(
        `SELECT id, email, username, phone, "firstName", "lastName", "hasPin", status FROM "customers" WHERE "id" = $1`,
        customerId
      );
      if (!result?.length) {
        return res.status(404).json({ success: false, message: 'Customer not found' });
      }
      const row = result[0];
      updatedCustomer = {
        id: row.id,
        email: row.email,
        username: row.username,
        phone: row.phone,
        firstName: row.firstName,
        lastName: row.lastName,
        hasPin: row.hasPin === true || row.hasPin === 'true' || row.hasPin === 1,
        status: row.status,
      };
    }

    return res.json({
      success: true,
      message: 'Password updated successfully',
      data: updatedCustomer,
    });
  } catch (error) {
    console.error('[changePassword] error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to change password',
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
    await ensureCustomerExtendedProfileColumns();
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
        middleName: true,
        lastName: true,
        telephone: true,
        phone: true,
        unitApt: true,
        zipCode: true,
        address: true,
        city: true,
        region: true,
        subRegion: true,
        country: true,
        dateOfBirth: true,
        occupation: true,
        sourceOfFund: true,
        nationality: true,
        status: true,
        hasPin: true,
        password: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    let profileImageFromDb = null;
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT "profileImage" FROM "customers" WHERE "id" = $1 LIMIT 1`,
        customerId
      );
      profileImageFromDb = rows?.[0]?.profileImage ?? null;
    } catch {
      /* column may not exist yet until ensureCustomerExtendedProfileColumns runs */
    }
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
      middle_name: customer.middleName || null,
      last_name: customer.lastName || null,
      phone_number,
      country_code: country_code || null,
      is_verified: customer.status === 'approved',
      has_pin: !!customer.hasPin,
      has_password: !!(customer.password && String(customer.password).trim()),
      profile_image: profileImageFromDb,
      address: customer.address || null,
      unit_apt: customer.unitApt || null,
      city: customer.city || null,
      region: customer.region || null,
      sub_region: customer.subRegion || null,
      zip_code: customer.zipCode || null,
      country: customer.country || null,
      date_of_birth: customer.dateOfBirth || null,
      occupation: customer.occupation || null,
      source_of_fund: customer.sourceOfFund || null,
      nationality: customer.nationality || null,
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

    let customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        status: true,
        approvedAt: true,
        approvedBy: true,
        kycData: true,
        kycRequestedAt: true,
        kycRequestedBy: true,
        kycRequestedFormId: true,
        kycRequestedFormName: true,
        kycRequestedMessage: true,
        kycRequestedFields: true,
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

    // Backfill: LiveEx Completed / docs+face match → mark customer + KYC approved
    try {
      const approval = await tryApprovePendingCustomerFromCachedStatus(customer, req);
      if (approval?.kycData != null || approval?.newlyApproved || approval?.customerApproved) {
        const refreshed = await prisma.customer.findUnique({
          where: { id: customerId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            status: true,
            approvedAt: true,
            approvedBy: true,
            kycData: true,
            kycRequestedAt: true,
            kycRequestedBy: true,
            kycRequestedFormId: true,
            kycRequestedFormName: true,
            kycRequestedMessage: true,
            kycRequestedFields: true,
          },
        });
        if (refreshed) customer = refreshed;
      }
    } catch (err) {
      console.warn('[getVerifications] cache auto-approve skipped:', err.message);
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

    const kycRequest =
      customer.kycRequestedAt != null
        ? {
            requestedAt: customer.kycRequestedAt,
            requestedBy: customer.kycRequestedBy ?? null,
            formId: customer.kycRequestedFormId ?? null,
            formName: customer.kycRequestedFormName ?? null,
            message: customer.kycRequestedMessage ?? null,
            fields: Array.isArray(customer.kycRequestedFields)
              ? customer.kycRequestedFields
              : customer.kycRequestedFields != null
                ? [customer.kycRequestedFields]
                : [],
          }
        : null;

    return res.json({
      success: true,
      data: kycDocuments,
      kycRequest,
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

// Get current user's tier (level) and transaction limits (for app: when KYC is approved, user transacts within these limits)
// Also returns kycMaxTransactionAmount: max per-transaction amount from approved KYC form (e.g. kyc2 = 2999)
export const getTierAndLimits = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }
    const [
      limits,
      nextLevel,
      kycApprovedMax,
      kycSubmittedMax,
      kycCountryMax,
      kycGlobalMin,
    ] = await Promise.all([
      getCustomerLimits(customerId),
      getNextLevelForCustomer(customerId),
      getApprovedKYCMaxAmount(customerId),
      getSubmittedKycMaxAmount(customerId),
      getActiveKycMaxAmountForCustomer(customerId),
      getMinimumActiveKycMaxAmount(),
    ]);

    // Portal "Max Transaction Amount" on the customer's primary KYC step (by country + priority).
    const kycMaxTransactionAmount =
      kycCountryMax ??
      kycSubmittedMax ??
      kycApprovedMax ??
      kycGlobalMin ??
      null;
    const minimumKycMaxAmount = kycGlobalMin ?? kycCountryMax ?? null;

    const baseData = buildTierLimitsForApp({
      limits,
      nextLevel: nextLevel
        ? {
            levelId: nextLevel.levelId,
            levelName: nextLevel.levelName,
            levelPriority: nextLevel.levelPriority,
            description: nextLevel.description ?? null,
            daily: nextLevel.daily,
            weekly: nextLevel.weekly,
            monthly: nextLevel.monthly,
            currency: nextLevel.currency,
          }
        : null,
      kycMaxTransactionAmount,
      minimumKycMaxAmount,
    });
    return res.json({
      success: true,
      data: baseData,
    });
  } catch (error) {
    console.error('Error getting tier and limits:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get tier and limits',
    });
  }
};

/** Parse recipientInfo JSON from a remittance transaction row. */
function parseRecipientInfoJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Recent unique recipients from the customer's sent transfers (Send Again / Quick Transfer).
 * GET /api/accounts/frequently-paid
 */
export const getFrequentlyPaid = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.findMany !== 'function') {
      return res.json({ success: true, data: [] });
    }

    const rows = await delegate.findMany({
      where: {
        customerId,
        type: 'Sent',
        status: {
          notIn: ['Failed', 'Cancelled', 'Canceled', 'Refunded', 'Rejected'],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });

    const seen = new Map();
    const contacts = [];

    for (const row of rows) {
      const ri = parseRecipientInfoJson(row.recipientInfo);
      const accountNumber = String(ri.accountNumber || ri.phone || '').replace(/\D/g, '');
      const name = String(
        ri.accountHolderName ||
          ri.recipientName ||
          ri.name ||
          ri.receiverName ||
          ri.beneficiaryName ||
          [ri.firstName, ri.lastName].filter(Boolean).join(' ') ||
          ''
      ).trim();
      const beneficiaryKey = String(ri.beneficiaryKey || ri.beneficiaryId || '').trim();
      const dedupeKey =
        beneficiaryKey ||
        (accountNumber || name ? `${accountNumber}|${name.toLowerCase()}` : '');
      if (!dedupeKey || seen.has(dedupeKey)) continue;

      const transferType =
        String(row.transferType || ri.transferType || 'bank').toLowerCase() === 'wallet'
          ? 'wallet'
          : 'bank';

      const contact = {
        id: String(row.id),
        name: name || 'Recipient',
        accountHolderName: name || 'Recipient',
        accountNumber: accountNumber || String(ri.accountNumber || ''),
        phone: String(ri.phone || ri.accountNumber || ''),
        countryCode: String(ri.countryCode || '').trim().toUpperCase() || undefined,
        countryId: ri.countryId ? String(ri.countryId) : undefined,
        bankId:
          transferType === 'bank' && ri.bankId
            ? String(ri.bankId)
            : transferType === 'wallet' && (ri.walletId || ri.bankId)
              ? String(ri.walletId || ri.bankId)
              : undefined,
        serviceProvider: String(ri.serviceProvider || ri.bankName || '').trim() || undefined,
        transferType,
        lastSentAt: row.createdAt,
        lastAmount: Number(row.sendAmount) || 0,
        currency: String(row.currency || 'USD'),
      };

      seen.set(dedupeKey, true);
      contacts.push(contact);
      if (contacts.length >= 12) break;
    }

    return res.json({
      success: true,
      data: contacts,
    });
  } catch (error) {
    console.error('Error getting frequently paid contacts:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get frequently paid contacts',
    });
  }
};

const SENT_TXN_EXCLUDE_STATUSES = ['Failed', 'Cancelled', 'Canceled', 'Refunded', 'Rejected'];

function recipientDedupeKey(ri) {
  const accountNumber = String(ri.accountNumber || ri.phone || '').replace(/\D/g, '');
  const name = String(
    ri.accountHolderName ||
      ri.recipientName ||
      ri.name ||
      ri.receiverName ||
      ri.beneficiaryName ||
      [ri.firstName, ri.lastName].filter(Boolean).join(' ') ||
      ''
  ).trim();
  const beneficiaryKey = String(ri.beneficiaryKey || ri.beneficiaryId || '').trim();
  return (
    beneficiaryKey ||
    (accountNumber || name ? `${accountNumber}|${name.toLowerCase()}` : '')
  );
}

/**
 * Profile hero stats for mobile app (Sent count, unique recipients, promotional savings).
 * GET /api/accounts/profile-stats
 */
export const getProfileStats = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const delegate = prisma.remittanceTransaction;
    if (!delegate || typeof delegate.findMany !== 'function') {
      return res.json({
        success: true,
        data: { sentCount: 0, recipientsCount: 0, savedAmount: 0, currency: 'USD' },
      });
    }

    const rows = await delegate.findMany({
      where: {
        customerId,
        type: 'Sent',
        status: { notIn: SENT_TXN_EXCLUDE_STATUSES },
      },
      select: {
        id: true,
        recipientInfo: true,
        sendAmount: true,
        currency: true,
      },
    });

    const seenRecipients = new Set();
    let savedAmount = 0;
    let currency = 'USD';

    for (const row of rows) {
      const ri = parseRecipientInfoJson(row.recipientInfo);
      const key = recipientDedupeKey(ri);
      if (key) seenRecipients.add(key);

      const gift = Number(ri.giftAmount ?? ri.gift_amount ?? 0);
      if (Number.isFinite(gift) && gift > 0) savedAmount += gift;

      if (row.currency) currency = String(row.currency);
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json({
      success: true,
      data: {
        sentCount: rows.length,
        recipientsCount: seenRecipients.size,
        savedAmount: Math.round(savedAmount * 100) / 100,
        currency,
      },
    });
  } catch (error) {
    console.error('Error getting profile stats:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to get profile stats',
    });
  }
};

// Get consumed (used) limits for current period (daily, weekly, monthly) so app can show remaining
export const getConsumedLimits = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }
    const now = new Date();
    const startDay = startOfDayUTC(now);
    const startWeek = startOfWeekUTC(now);
    const startMonth = startOfMonthUTC(now);
    const [usedDaily, usedWeekly, usedMonthly] = await Promise.all([
      getSentInPeriod(customerId, startDay, now),
      getSentInPeriod(customerId, startWeek, now),
      getSentInPeriod(customerId, startMonth, now),
    ]);
    return res.json({
      success: true,
      data: {
        usedDaily,
        usedWeekly,
        usedMonthly,
      },
    });
  } catch (error) {
    console.error('Error getting consumed limits:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get consumed limits',
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
          const strVal =
            typeof value === 'string' ? value : JSON.stringify(value);
          const looksLikeUpload =
            typeof strVal === 'string' &&
            (strVal.startsWith('http://') ||
              strVal.startsWith('https://') ||
              strVal.startsWith('/') ||
              strVal.includes('/uploads/'));
          fields.push({
            id: `field_${key}_${Date.now()}`,
            fieldName: key,
            inputType: 'text',
            value: strVal,
            // Relative /uploads paths (Capacitor / local API) must keep fileUrl too
            fileUrl: looksLikeUpload ? strVal : null,
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
    try {
      await ensureCustomerLevelAssigned(customerId);
    } catch (levelErr) {
      console.warn('[saveKycDetails] Could not assign default level:', levelErr?.message);
    }
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
    
    const trimmedToken = token.trim();
    console.log('[PUSH] 📥 Received FCM token update request from customer:', customerId);
    console.log('[PUSH] Token preview:', trimmedToken.substring(0, 30) + '...');
    
    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: { fcmToken: trimmedToken },
      select: { id: true, email: true, firstName: true, lastName: true, fcmToken: true },
    });
    
    console.log('[PUSH] ✅ FCM token saved successfully for customer:', {
      id: updated.id,
      email: updated.email,
      name: `${updated.firstName || ''} ${updated.lastName || ''}`.trim() || 'N/A',
      tokenSaved: !!updated.fcmToken
    });
    
    return res.json({
      success: true,
      message: 'Push token updated',
      customerId: updated.id,
    });
  } catch (error) {
    console.error('Error updating push token:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update push token',
    });
  }
};

// Report device info and optional location (authenticated customer - mobile app)
export const reportDeviceInfo = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const { deviceInfo, location } = req.body || {};
    const updateData = { lastSeenAt: new Date() };
    if (deviceInfo != null && typeof deviceInfo === 'object') {
      updateData.lastDeviceInfo = deviceInfo;
    }
    if (location != null && typeof location === 'object') {
      updateData.lastLocation = location;
    }
    const deviceIp = extractClientIp(req);
    if (deviceIp) updateData.lastIpAddress = deviceIp;
    await prisma.customer.update({
      where: { id: customerId },
      data: updateData,
    });
    return res.json({ success: true, message: 'Device info updated' });
  } catch (error) {
    console.error('Error reporting device info:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update device info' });
  }
};

// Get all customers
export const getAllCustomers = async (req, res) => {
  try {
    const { search, status } = req.query;
    const { parsePaginationQuery, parseSortQuery, sendPaginatedJson } = await import('../utils/pagination.js');
    const pagination = parsePaginationQuery(req.query, { defaultLimit: 50, maxLimit: 200 });

    const where = {};
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) {
      where.status = String(status).toLowerCase();
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
      address: true,
      status: true,
      approvedAt: true,
      level: true,
      balanceLimit: true,
      createdAt: true,
    };

    const [customers, total, statusGroups] = await Promise.all([
      prisma.customer.findMany({
        where,
        select: {
          ...select,
          kycData: true,
        },
        orderBy,
        take: pagination.take,
        skip: pagination.skip,
      }),
      prisma.customer.count({ where }),
      prisma.customer.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ]);

    // Backfill: auto-approve pending customers that already have LiveEx/AML statusId >= 1
    await Promise.all(
      customers
        .filter((c) => String(c.status || '').toLowerCase() === 'pending')
        .map(async (c) => {
          try {
            const result = await tryApprovePendingCustomerFromCachedStatus(c, req);
            if (result.newlyApproved) {
              c.status = result.customerStatus || 'approved';
              c.approvedAt = c.approvedAt || new Date();
            }
          } catch (err) {
            console.warn('[Customer] cache auto-approve skipped:', c.id, err.message);
          }
        }),
    );

    const publicCustomers = customers.map(({ kycData, ...rest }) => rest);

    // Recompute stats after possible approvals on this page
    let stats = { pending: 0, approved: 0, rejected: 0, blocked: 0, other: 0 };
    if (customers.some((c) => String(c.status).toLowerCase() === 'approved')) {
      const freshGroups = await prisma.customer.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      });
      for (const row of freshGroups) {
        const key = String(row.status || '').toLowerCase();
        const count = row._count?._all ?? 0;
        if (key in stats) stats[key] += count;
        else stats.other += count;
      }
    } else {
      for (const row of statusGroups) {
        const key = String(row.status || '').toLowerCase();
        const count = row._count?._all ?? 0;
        if (key in stats) stats[key] += count;
        else stats.other += count;
      }
    }

    sendPaginatedJson(res, {
      data: publicCustomers,
      total,
      pagination,
      extra: { stats },
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get customer by ID (full profile for portal - exclude password/pin)
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    await ensureCustomerExtendedProfileColumns();

    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT
          "id",
          "email",
          "username",
          "firstName",
          "middleName",
          "lastName",
          "telephone",
          "phone",
          "unitApt",
          "zipCode",
          "address",
          "status",
          "approvedAt",
          "approvedBy",
          "level",
          "balanceLimit",
          "availableBalance",
          "dateOfBirth",
          "gender",
          "nationality",
          "placeOfBirth",
          "occupation",
          "sourceOfFund",
          "residentCountry",
          "country",
          "region",
          "subRegion",
          "city",
          "kycData",
          "kycRequestedAt",
          "fcmToken",
          "lastDeviceInfo",
          "lastLocation",
          "lastIpAddress",
          "lastSeenAt",
          "createdAt",
          "updatedAt"
        FROM "customers"
        WHERE "id" = $1
        LIMIT 1
      `,
      id
    );
    const customer = rows?.[0] || null;

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const resolvedIp = await resolveLastIpForApi(customer, prisma);
    if (resolvedIp) {
      customer.lastIpAddress = resolvedIp;
    }
    Object.assign(customer, buildClientIpFields(resolvedIp || customer.lastIpAddress));

    if (String(customer.status || '').toLowerCase() === 'pending') {
      try {
        const result = await tryApprovePendingCustomerFromCachedStatus(customer, req);
        if (result.newlyApproved) {
          customer.status = result.customerStatus || 'approved';
          customer.approvedAt = customer.approvedAt || new Date();
          customer.approvedBy = customer.approvedBy || 'cache-auto';
          if (result.kycData) customer.kycData = result.kycData;
        }
      } catch (err) {
        console.warn('[Customer] detail cache auto-approve skipped:', err.message);
      }
    }

    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get customer device/location info by email (for backoffice user profile when same person has customer account)
export const getCustomerDeviceInfoByEmail = async (req, res) => {
  try {
    const email = req.query?.email;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Email query is required' });
    }
    const customer = await prisma.customer.findFirst({
      where: { email: email.trim() },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        email: true,
        phone: true,
        telephone: true,
        address: true,
        unitApt: true,
        city: true,
        region: true,
        zipCode: true,
        country: true,
        residentCountry: true,
        nationality: true,
        dateOfBirth: true,
        gender: true,
        placeOfBirth: true,
        occupation: true,
        sourceOfFund: true,
        kycData: true,
        availableBalance: true,
        status: true,
        lastDeviceInfo: true,
        lastLocation: true,
        lastSeenAt: true,
      },
    });
    if (!customer) {
      return res.json({ success: true, data: {} });
    }
    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Error fetching customer device info by email:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/** Accept /uploads/ paths or full S3/CDN URLs for notification images. */
function normalizeNotificationImageUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    if (trimmed.startsWith('/uploads/')) return trimmed;
    const u = new URL(trimmed);
    if (u.pathname.startsWith('/uploads/')) {
      return `${u.pathname}${u.search || ''}`;
    }
    return trimmed;
  } catch {
    if (trimmed.startsWith('/uploads/')) return trimmed;
    return trimmed;
  }
}

// Admin: broadcast notification to every customer (portal Customer Management).
export const broadcastNotificationToAllCustomers = async (req, res) => {
  try {
    const { title, body, image } = req.body || {};
    if (!prisma.customerNotification) {
      return res.status(500).json({
        success: false,
        message: 'Notifications not available. Run: npx prisma generate',
      });
    }

    const notificationTitle =
      typeof title === 'string' && title.trim() ? title.trim() : 'BrandPay';
    const notificationBody = typeof body === 'string' ? body.trim() : '';
    if (!notificationBody) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }
    const imageUrl = normalizeNotificationImageUrl(image);

    const totalCustomers = await prisma.customer.count();
    if (totalCustomers === 0) {
      return res.json({
        success: true,
        message: 'No customers to notify',
        total: 0,
        saved: 0,
        pushed: 0,
      });
    }

    const { enqueueBroadcastNotificationJob } = await import('../queues/enqueue.js');
    const queueResult = await enqueueBroadcastNotificationJob({
      title: notificationTitle,
      body: notificationBody,
      imageUrl,
    });

    res.status(202).json({
      success: true,
      message: `Broadcast queued for ${totalCustomers} customer${totalCustomers === 1 ? '' : 's'}. Notifications are processing in the background.`,
      total: totalCustomers,
      queued: queueResult.queued,
      mode: queueResult.mode,
      jobId: queueResult.jobId,
    });
  } catch (error) {
    console.error('Error broadcasting notification:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin: send push notification to customer's app (with optional image). Saves to CustomerNotification so it appears in app list.
export const sendNotificationToCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, body, image } = req.body || {};
    if (!id) {
      return res.status(400).json({ success: false, message: 'Customer ID is required' });
    }
    // First try to find customer by ID
    let customer = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, fcmToken: true, firstName: true, lastName: true, email: true, phone: true },
    });
    
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    console.log('[Notification] 🔍 Customer found:', {
      id: customer.id,
      email: customer.email,
      phone: customer.phone,
      name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email,
      hasFcmToken: !!customer.fcmToken,
      fcmTokenPreview: customer.fcmToken ? customer.fcmToken.substring(0, 30) + '...' : 'NONE',
      fcmTokenLength: customer.fcmToken ? customer.fcmToken.length : 0
    });
    
    // If no token, try to find if there's another customer record with same email/phone that has a token
    // This handles cases where user might have multiple accounts or token was saved to different record
    if (!customer.fcmToken) {
      console.log('[Notification] 🔍 No token found. Searching for other records with same email/phone...');
      
      const orConditions = [];
      if (customer.email) orConditions.push({ email: customer.email });
      if (customer.phone) orConditions.push({ phone: customer.phone });
      
      if (orConditions.length > 0) {
        const customersWithToken = await prisma.customer.findMany({
          where: {
            OR: orConditions,
            fcmToken: { not: null },
            NOT: { id: customer.id }, // Exclude current customer
          },
          select: { id: true, fcmToken: true, email: true, phone: true },
          take: 1,
        });
        
        if (customersWithToken.length > 0) {
          const customerWithToken = customersWithToken[0];
          console.log('[Notification] ✅ Found token in another customer record:', {
            originalId: customer.id,
            tokenRecordId: customerWithToken.id,
            email: customerWithToken.email,
            phone: customerWithToken.phone,
          });
          // Use the token from the other record
          customer.fcmToken = customerWithToken.fcmToken;
        } else {
          console.log('[Notification] ❌ No token found in any related customer records');
        }
      }
    }
    
    const notificationTitle = typeof title === 'string' && title.trim() ? title.trim() : 'BrandPay';
    const notificationBody = typeof body === 'string' ? body.trim() : '';
    const imageUrl = normalizeNotificationImageUrl(image);

    // Save to CustomerNotification so it appears in the app's notifications list (use string id for consistency)
    const customerIdStr = String(id);
    
    // Check if customerNotification model is available (Prisma client must be regenerated)
    if (!prisma.customerNotification) {
      console.error('Prisma client missing customerNotification model. Run: npx prisma generate');
      return res.status(500).json({ 
        success: false, 
        error: 'Database model not available. Please regenerate Prisma client: npx prisma generate' 
      });
    }
    
    const created = await prisma.customerNotification.create({
      data: {
        customerId: customerIdStr,
        title: notificationTitle,
        body: notificationBody,
        imageUrl,
      },
    });
    
    console.log('[Notification] ✅ Notification saved to database:', created.id);

    // Emit via Socket.IO so the app can show the notification in real time (customer must have joined room user:${id})
    try {
      const io = req.app?.get?.('io');
      if (io) {
        const payload = {
          id: created.id,
          title: notificationTitle,
          body: notificationBody,
          imageUrl: imageUrl || null,
          sentAt: created.sentAt?.toISOString?.() || new Date().toISOString(),
        };
        io.to(`user:${customerIdStr}`).emit('admin:notification', payload);
        console.log('[Notification] ✅ Socket.IO notification emitted to room:', `user:${customerIdStr}`);
      } else {
        console.warn('[Notification] ⚠️ Socket.IO not available');
      }
    } catch (e) {
      console.warn('[Notification] Socket emit failed:', e?.message || e);
    }

    // Try to send push notification if token exists
    if (!customer.fcmToken) {
      console.warn('[Notification] ⚠️ Customer has no FCM token. Notification saved but not pushed.');
      console.warn('[Notification] Customer needs to:');
      console.warn('[Notification]   1. Open the app');
      console.warn('[Notification]   2. Log in');
      console.warn('[Notification]   3. Token will be saved automatically');
      return res.json({
        success: true,
        message: 'Notification saved. It will appear in the app when the customer opens it. They have not registered a device yet. Please ask the customer to open the app and log in to receive push notifications.',
        saved: true,
        pushed: false,
        reason: 'No FCM token registered'
      });
    }
    
    console.log('[Notification] 📤 Attempting to send push notification...');
    const fcmToken =
      customer.fcmToken || (await resolveCustomerFcmToken(id));
    const pushResult = await sendPushToToken(fcmToken, {
      title: notificationTitle,
      body: notificationBody,
      image: imageUrl || undefined,
      data: {
        screen: 'notifications',
        type: 'admin',
        notificationId: String(created.id),
      },
    });
    
    if (!pushResult || !pushResult.success) {
      const errorCode = pushResult?.code || 'UNKNOWN';
      const errorMessage = pushResult?.error || 'Failed to deliver notification';
      const errorDetails = pushResult?.details || '';
      
      console.error('[Notification] ❌ Failed to send push notification');
      console.error('[Notification] Error code:', errorCode);
      console.error('[Notification] Error message:', errorMessage);
      if (errorDetails) {
        console.error('[Notification] Error details:', errorDetails);
      }
      
      // If token is invalid, suggest clearing it
      if (errorCode === 'messaging/registration-token-not-registered' || 
          errorCode === 'messaging/invalid-registration-token') {
        console.warn('[Notification] 💡 Consider clearing the invalid FCM token from customer record');
      }
      
      // Missing Firebase credentials: still success for inbox; don't use 502 (portal treats as hard error)
      if (errorCode === 'FIREBASE_NOT_CONFIGURED') {
        return res.json({
          success: true,
          message:
            'Notification saved in the app inbox. Device push is unavailable until Firebase is configured on the backend.',
          saved: true,
          pushed: false,
          reason: errorMessage,
          errorCode: errorCode,
        });
      }

      return res.status(502).json({
        success: false,
        message: errorMessage + ' Notification is saved and will show in the app.',
        saved: true,
        pushed: false,
        reason: errorMessage,
        errorCode: errorCode,
        errorDetails: errorDetails
      });
    }
    
    console.log('[Notification] ✅ Push notification sent successfully');
    res.json({ 
      success: true, 
      message: 'Notification sent to customer\'s app.',
      saved: true,
      pushed: true
    });
  } catch (error) {
    console.error('Error sending notification to customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get list of notifications for the authenticated customer (for in-app notifications screen)
export const getCustomerNotifications = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const id = String(customerId);
    const { parsePaginationQuery, sendPaginatedJson } = await import('../utils/pagination.js');
    const pagination = parsePaginationQuery(req.query, { defaultLimit: 50, maxLimit: 100 });

    const where = { customerId: id };
    const select = { id: true, title: true, body: true, imageUrl: true, sentAt: true, readAt: true };

    const [notifications, total] = await Promise.all([
      prisma.customerNotification.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        take: pagination.take,
        skip: pagination.skip,
        select,
      }),
      prisma.customerNotification.count({ where }),
    ]);

    const data = notifications.map((n) => ({
      ...n,
      imageUrl: normalizeNotificationImageUrl(n.imageUrl) ?? n.imageUrl,
    }));

    sendPaginatedJson(res, { data, total, pagination });
  } catch (error) {
    console.error('Error fetching customer notifications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Mark one notification as read (mobile app detail view)
export const markCustomerNotificationRead = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Notification ID is required' });
    }
    if (!prisma.customerNotification) {
      return res.status(500).json({ success: false, message: 'Notifications not available' });
    }
    const existing = await prisma.customerNotification.findFirst({
      where: { id: String(id), customerId: String(customerId) },
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    const updated = await prisma.customerNotification.update({
      where: { id: String(id) },
      data: { readAt: existing.readAt || new Date() },
      select: { id: true, title: true, body: true, imageUrl: true, sentAt: true, readAt: true },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Mark all notifications as read (mobile app)
export const markAllCustomerNotificationsRead = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (!prisma.customerNotification) {
      return res.status(500).json({ success: false, message: 'Notifications not available' });
    }
    const now = new Date();
    await prisma.customerNotification.updateMany({
      where: { customerId: String(customerId), readAt: null },
      data: { readAt: now },
    });
    res.json({ success: true, readAt: now.toISOString() });
  } catch (error) {
    console.error('Error marking all notifications read:', error);
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

    emitCustomersUpdated(req);
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

    emitCustomersUpdated(req);
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

