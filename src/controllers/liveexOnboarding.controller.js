/**
 * LiveEx Digital Onboarding — mobile registration + portal admin.
 */

import prisma from '../utils/prisma.js';
import {
  getDigitalOnboardingPublicStatus,
  isDigitalOnboardingEnabled,
  liveexSendOtp,
  liveexVerifyOtp,
  liveexSaveWebsite,
  liveexTempDocument,
  liveexCustomerDetails,
  liveexSubmitKyc,
  liveexLookupSourceOfFund,
  liveexLookupCountries,
  liveexLookupPurposes,
  liveexLookupJobTitles,
  liveexLookupIndustries,
} from '../services/liveexDigitalOnboarding.service.js';
import {
  buildSaveWebsitePayload,
  buildSubmitKycPayload,
  extractDigitalOnboarding,
  mergeDigitalOnboarding,
  uploadIdentityTempDocuments,
} from '../services/liveexOnboarding.builder.js';
import { maybeAutoApproveCustomerFromLiveex } from '../utils/amlAutoApprove.js';

function sendError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({
    success: false,
    message: err.message || 'LiveEx Digital Onboarding error',
    code: err.code || undefined,
    data: err.data || undefined,
  });
}

async function loadCustomerById(id) {
  if (!id) return null;
  return prisma.customer.findUnique({ where: { id } });
}

async function loadCustomerFromReq(req) {
  return loadCustomerById(req.customer?.id || req.user?.id);
}

export const getLiveexOnboardingStatus = async (_req, res) => {
  try {
    return res.json({ success: true, ...getDigitalOnboardingPublicStatus() });
  } catch (err) {
    return sendError(res, err);
  }
};

export const liveexOnboardSendOtp = async (req, res) => {
  try {
    if (!isDigitalOnboardingEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'LiveEx Digital Onboarding is disabled',
        code: 'LIVEEX_ONBOARD_DISABLED',
      });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    const raw = await liveexSendOtp({
      email,
      title: req.body?.title || 'Verify your email',
      subject: req.body?.subject || 'Your remittance verification code',
    });
    return res.json({
      success: true,
      message: raw?.message || 'OTP sent',
      messageCode: raw?.messageCode || 'SUCCESS',
    });
  } catch (err) {
    return sendError(res, err);
  }
};

export const liveexOnboardVerifyOtp = async (req, res) => {
  try {
    if (!isDigitalOnboardingEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'LiveEx Digital Onboarding is disabled',
        code: 'LIVEEX_ONBOARD_DISABLED',
      });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const otp = String(req.body?.otp || '').trim();
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'email and otp are required' });
    }

    const raw = await liveexVerifyOtp({ email, otp });
    const rowIdGid = raw?.rowIdGid || raw?.rowId || null;
    if (!rowIdGid) {
      return res.status(400).json({
        success: false,
        message: 'LiveEx did not return rowIdGid',
        data: raw,
      });
    }

    const customer = await loadCustomerFromReq(req);
    if (customer) {
      const kycData = mergeDigitalOnboarding(customer, {
        rowIdGid,
        email,
        statusId: raw?.statusId ?? null,
        otpVerifiedAt: new Date().toISOString(),
        lastOtpVerifyResponse: raw,
      });
      await prisma.customer.update({
        where: { id: customer.id },
        data: { kycData, ...(customer.email !== email ? { email } : {}) },
      });
    }

    return res.json({
      success: true,
      message: raw?.message || 'Verified',
      messageCode: raw?.messageCode || 'SUCCESS',
      rowIdGid,
      statusId: raw?.statusId ?? null,
      persisted: Boolean(customer),
    });
  } catch (err) {
    return sendError(res, err);
  }
};

export const liveexOnboardAttachRow = async (req, res) => {
  try {
    const customer = await loadCustomerFromReq(req);
    if (!customer) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const rowIdGid = String(req.body?.rowIdGid || '').trim();
    const email = String(req.body?.email || customer.email || '')
      .trim()
      .toLowerCase();
    if (!rowIdGid) {
      return res.status(400).json({ success: false, message: 'rowIdGid is required' });
    }

    const kycData = mergeDigitalOnboarding(customer, {
      rowIdGid,
      email,
      attachedAt: new Date().toISOString(),
    });
    await prisma.customer.update({ where: { id: customer.id }, data: { kycData } });
    return res.json({ success: true, rowIdGid, email });
  } catch (err) {
    return sendError(res, err);
  }
};

async function runFullDigitalOnboarding(customer, options = {}, req = null) {
  let dig = extractDigitalOnboarding(customer);
  let rowIdGid = String(options.rowIdGid || dig?.rowIdGid || '').trim();
  if (!rowIdGid) {
    const err = new Error(
      'LiveEx email verification is required before face/ID checks. Complete email OTP during registration.',
    );
    err.status = 400;
    err.code = 'LIVEEX_ROW_ID_REQUIRED';
    throw err;
  }

  const email = String(options.email || dig?.email || customer.email || '')
    .trim()
    .toLowerCase();

  if (!dig?.rowIdGid) {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        kycData: mergeDigitalOnboarding(customer, {
          rowIdGid,
          email,
          attachedAt: new Date().toISOString(),
        }),
      },
    });
    dig = extractDigitalOnboarding(customer);
  }

  const savePayload = buildSaveWebsitePayload(customer, { rowIdGid });
  const saveRaw = await liveexSaveWebsite(savePayload);
  customer = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      kycData: mergeDigitalOnboarding(customer, {
        rowIdGid,
        email,
        profileSavedAt: new Date().toISOString(),
        lastSaveWebsiteResponse: saveRaw,
      }),
    },
  });

  let uploaded;
  try {
    uploaded = await uploadIdentityTempDocuments({
      customer,
      rowIdGid,
      email,
      retakeCount: Number(options.retakeCount || 0),
      idType: Number(options.idType || dig?.idType || 1),
      docTypeName: options.docTypeName || 'Passport',
      liveexTempDocument,
    });
  } catch (err) {
    const msg = String(err?.message || '');
    const faceFail =
      err?.code === 'VALIDATION_ERROR' ||
      err?.code === 'LIVEEX_FACE_MISMATCH' ||
      /selfie does not match|face\s*match|does not match the id/i.test(msg);
    if (faceFail) {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          kycData: mergeDigitalOnboarding(customer, {
            rowIdGid,
            email,
            faceMatchFailed: true,
            faceMatchMessage: msg,
            faceMatchScore: err?.data?.score ?? 0,
            faceMatchConfidence: err?.data?.confidence ?? 0,
            identityUploadErrorAt: new Date().toISOString(),
            lastTempDocumentError: err?.data || { message: msg },
          }),
        },
      });
      const faceErr = new Error(
        msg || 'Selfie does not match the ID card. Please try again.',
      );
      faceErr.status = 200;
      faceErr.code = 'LIVEEX_FACE_MISMATCH';
      faceErr.faceMatchFailed = true;
      faceErr.data = {
        faceMatchFailed: true,
        message: faceErr.message,
        faceMatchScore: err?.data?.score ?? 0,
        faceMatchConfidence: err?.data?.confidence ?? 0,
        digitalOnboarding: extractDigitalOnboarding(customer),
      };
      throw faceErr;
    }
    throw err;
  }

  customer = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      kycData: mergeDigitalOnboarding(customer, {
        rowIdGid,
        email,
        paths: uploaded.paths,
        lastTempDocumentResponses: uploaded.responses,
        identityUploadedAt: new Date().toISOString(),
        faceMatchFailed: false,
        faceMatchScore: uploaded.responses?.selfie?.score ?? null,
        faceMatchConfidence: uploaded.responses?.selfie?.confidence ?? null,
      }),
    },
  });

  const submitPayload = await buildSubmitKycPayload(customer, {
    rowIdGid,
    paths: uploaded.paths,
  });
  const submitRaw = await liveexSubmitKyc(submitPayload);

  const faceMatchScore = uploaded.responses?.selfie?.score ?? null;
  const faceMatchConfidence = uploaded.responses?.selfie?.confidence ?? null;
  const submitMatch = submitRaw?.matchConfidence;
  const bestMatch =
    (Number(submitMatch) > 0 ? Number(submitMatch) : null) ??
    (Number(faceMatchScore) > 0 ? Number(faceMatchScore) : null) ??
    (Number(faceMatchConfidence) > 0 ? Number(faceMatchConfidence) : null) ??
    (submitMatch != null ? Number(submitMatch) : null);

  customer = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      kycData: mergeDigitalOnboarding(customer, {
        rowIdGid,
        email,
        paths: uploaded.paths,
        clientNumber: submitRaw?.clientNumber || null,
        onBoardStatus: submitRaw?.onBoardStatus || null,
        onBoardStatusId: submitRaw?.onBoardStatusId ?? null,
        matchConfidence: bestMatch,
        faceMatchScore,
        faceMatchConfidence,
        idNumber: submitRaw?.idNumber || null,
        idTypeLabel: submitRaw?.idType || null,
        submittedAt: new Date().toISOString(),
        lastSubmitKycResponse: submitRaw,
      }),
    },
  });

  // Pull pipeline status (ISTR Pending / Onboard Success) when available
  let detailsRaw = null;
  try {
    detailsRaw = await liveexCustomerDetails({ rowIdGid, email });
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        kycData: mergeDigitalOnboarding(customer, {
          rowIdGid,
          email,
          statusId: detailsRaw?.statusId ?? null,
          statusLabel: detailsRaw?.status || null,
          matchConfidence: detailsRaw?.matchConfidence ?? bestMatch,
          lastDetailsResponse: detailsRaw,
        }),
      },
    });
  } catch (detailsErr) {
    console.warn(
      `[LiveEx-Onboard] post-submit details fetch failed for ${customer.id}:`,
      detailsErr.message,
    );
  }

  dig = extractDigitalOnboarding(customer);
  const approval = await maybeAutoApproveCustomerFromLiveex(
    customer,
    customer.kycData,
    dig,
    req,
    'liveex-registration-auto',
  );
  if (approval.newlyApproved) {
    customer = await prisma.customer.findUnique({ where: { id: customer.id } });
  }

  return {
    rowIdGid,
    onBoardStatus: submitRaw?.onBoardStatus,
    onBoardStatusId: submitRaw?.onBoardStatusId,
    clientNumber: submitRaw?.clientNumber,
    matchConfidence: bestMatch,
    faceMatchScore,
    faceMatchConfidence,
    idNumber: submitRaw?.idNumber,
    idType: submitRaw?.idType,
    paths: uploaded.paths,
    digitalOnboarding: extractDigitalOnboarding(customer),
    submitRaw,
    detailsRaw,
    customerApproved: approval.customerApproved,
    customerStatus: approval.customerStatus,
  };
}

export const liveexOnboardRunRegistration = async (req, res) => {
  try {
    if (!isDigitalOnboardingEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'LiveEx Digital Onboarding is disabled',
        code: 'LIVEEX_ONBOARD_DISABLED',
      });
    }
    const customer = await loadCustomerFromReq(req);
    if (!customer) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const result = await runFullDigitalOnboarding(customer, req.body || {}, req);
    return res.json({
      success: true,
      faceMatchFailed: false,
      message: 'Digital onboarding (face/ID verification) complete',
      ...result,
    });
  } catch (err) {
    console.error('[LiveEx-Onboard] run-registration failed:', err.message);
    // Soft response so the app can show "ID not match" on the reviewing screen
    if (err.code === 'LIVEEX_FACE_MISMATCH' || err.faceMatchFailed) {
      return res.status(200).json({
        success: false,
        faceMatchFailed: true,
        code: 'LIVEEX_FACE_MISMATCH',
        message:
          err.message ||
          'Selfie does not match the ID card. Please try again.',
        ...(err.data && typeof err.data === 'object' ? err.data : {}),
      });
    }
    return sendError(res, err);
  }
};

export const liveexOnboardDetails = async (req, res) => {
  try {
    const customer = await loadCustomerFromReq(req);
    if (!customer) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const dig = extractDigitalOnboarding(customer);
    const rowIdGid = String(req.body?.rowIdGid || dig?.rowIdGid || '').trim();
    const email = String(req.body?.email || dig?.email || customer.email || '')
      .trim()
      .toLowerCase();
    if (!rowIdGid) {
      return res.status(400).json({
        success: false,
        message: 'rowIdGid required',
        code: 'LIVEEX_ROW_ID_REQUIRED',
      });
    }
    const raw = await liveexCustomerDetails({ rowIdGid, email });
    const kycData = mergeDigitalOnboarding(customer, {
      rowIdGid,
      email,
      statusId: raw?.statusId ?? null,
      statusLabel: raw?.status || null,
      lastDetailsResponse: raw,
    });
    await prisma.customer.update({ where: { id: customer.id }, data: { kycData } });
    const digCached = extractDigitalOnboarding({ kycData });
    const approval = await maybeAutoApproveCustomerFromLiveex(
      { ...customer, kycData },
      kycData,
      digCached,
      req,
      'liveex-details-auto',
    );
    return res.json({
      success: true,
      data: raw,
      cached: digCached,
      customerApproved: approval.customerApproved,
      customerStatus: approval.customerStatus,
    });
  } catch (err) {
    return sendError(res, err);
  }
};

export const liveexOnboardLookup = async (req, res) => {
  try {
    const type = String(req.params.type || '').toLowerCase();
    const map = {
      'source-of-fund': liveexLookupSourceOfFund,
      countries: liveexLookupCountries,
      purposes: liveexLookupPurposes,
      'job-titles': liveexLookupJobTitles,
      industries: liveexLookupIndustries,
    };
    const fn = map[type];
    if (!fn) {
      return res.status(400).json({ success: false, message: `Unknown lookup: ${type}` });
    }
    const data = await fn();
    return res.json({ success: true, ...data });
  } catch (err) {
    return sendError(res, err);
  }
};

/** Portal: cached Digital Onboarding snapshot from kycData */
export const getCustomerLiveexCached = async (req, res) => {
  try {
    const customer = await loadCustomerById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    return res.json({
      success: true,
      digitalOnboarding: extractDigitalOnboarding(customer),
      status: getDigitalOnboardingPublicStatus(),
    });
  } catch (err) {
    return sendError(res, err);
  }
};

/** Portal: refresh live details from LiveEx */
export const refreshCustomerLiveexDetails = async (req, res) => {
  try {
    const customer = await loadCustomerById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const dig = extractDigitalOnboarding(customer);
    const rowIdGid = dig?.rowIdGid;
    const email = dig?.email || customer.email;
    if (!rowIdGid) {
      return res.status(400).json({
        success: false,
        message: 'No LiveEx rowIdGid on this customer yet',
        code: 'LIVEEX_ROW_ID_REQUIRED',
        digitalOnboarding: dig,
      });
    }
    const raw = await liveexCustomerDetails({ rowIdGid, email });
    const kycData = mergeDigitalOnboarding(customer, {
      rowIdGid,
      email,
      statusId: raw?.statusId ?? null,
      statusLabel: raw?.status || null,
      matchConfidence: raw?.matchConfidence ?? dig?.matchConfidence ?? null,
      lastDetailsResponse: raw,
    });
    await prisma.customer.update({ where: { id: customer.id }, data: { kycData } });
    const digCached = extractDigitalOnboarding({ kycData });
    const approval = await maybeAutoApproveCustomerFromLiveex(
      { ...customer, kycData },
      kycData,
      digCached,
      req,
      'liveex-refresh-auto',
    );
    return res.json({
      success: true,
      data: raw,
      digitalOnboarding: digCached,
      customerApproved: approval.customerApproved,
      customerStatus: approval.customerStatus,
    });
  } catch (err) {
    return sendError(res, err);
  }
};

/** Portal: re-run face/ID CIP for a customer */
export const runCustomerLiveexOnboarding = async (req, res) => {
  try {
    if (!isDigitalOnboardingEnabled()) {
      return res.status(503).json({
        success: false,
        message: 'LiveEx Digital Onboarding is disabled',
        code: 'LIVEEX_ONBOARD_DISABLED',
      });
    }
    const customer = await loadCustomerById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const result = await runFullDigitalOnboarding(customer, req.body || {}, req);
    return res.json({
      success: true,
      message: 'Digital onboarding complete',
      ...result,
    });
  } catch (err) {
    console.error('[LiveEx-Onboard] admin run failed:', err.message);
    return sendError(res, err);
  }
};
