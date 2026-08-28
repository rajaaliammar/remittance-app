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
  resolveDocTypeFromCustomer,
  uploadIdentityTempDocuments,
} from '../services/liveexOnboarding.builder.js';
import { syncCustomerStatusFromLiveexOnboard, tryApprovePendingCustomerFromCachedStatus } from '../utils/amlAutoApprove.js';
import {
  isLiveexDecisionSettled,
  pollLiveexDetailsRapidly,
} from '../utils/liveexDetailsSync.js';

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

function pickLiveexRowId(raw) {
  if (!raw || typeof raw !== 'object') return '';
  const nested = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const result = raw.result && typeof raw.result === 'object' ? raw.result : {};
  return String(
    raw.rowIdGid ||
      raw.rowId ||
      raw.ROW_ID_GID ||
      raw.roW_ID_GID ||
      nested.rowIdGid ||
      nested.rowId ||
      result.rowIdGid ||
      result.rowId ||
      '',
  ).trim();
}

/**
 * LiveEx applicant id must come from /api/otp/verify (rowIdGid).
 * Do not invent UUIDs or treat OTP send as creating an applicant.
 */
async function ensureLiveexApplicant(customer, email, preferredRowId) {
  let rowIdGid = String(
    preferredRowId || extractDigitalOnboarding(customer)?.rowIdGid || '',
  ).trim();
  if (rowIdGid) {
    const dig = extractDigitalOnboarding(customer);
    if (dig?.rowIdGid !== rowIdGid || dig?.email !== email) {
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
    }
    return { customer, rowIdGid };
  }

  const err = new Error(
    'Verify your email with the LiveEx OTP before continuing profile completion.',
  );
  err.status = 400;
  err.code = 'LIVEEX_OTP_REQUIRED';
  throw err;
}

async function runFullDigitalOnboarding(customer, options = {}, req = null) {
  const email = String(options.email || extractDigitalOnboarding(customer)?.email || customer.email || '')
    .trim()
    .toLowerCase();

  if (!email || !email.includes('@') || email.endsWith('@remittance.pending')) {
    const err = new Error(
      'A real email is required to create the LiveEx customer profile.',
    );
    err.status = 400;
    err.code = 'LIVEEX_EMAIL_REQUIRED';
    throw err;
  }

  let ensured = await ensureLiveexApplicant(
    customer,
    email,
    options.rowIdGid || options.rowId,
  );
  customer = ensured.customer;
  let rowIdGid = ensured.rowIdGid;
  let dig = extractDigitalOnboarding(customer);

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

  const resolvedDoc = resolveDocTypeFromCustomer(customer, options);

  const savePayload = buildSaveWebsitePayload(customer, {
    rowIdGid,
    sendUrl: options.sendUrl,
  });
  const saveRaw = await liveexSaveWebsite(savePayload);
  const savedRow = pickLiveexRowId(saveRaw);
  if (savedRow) rowIdGid = savedRow;
  customer = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      kycData: mergeDigitalOnboarding(customer, {
        rowIdGid,
        email,
        idType: resolvedDoc.docTypeId,
        docTypeName: resolvedDoc.docTypeName,
        profileSavedAt: new Date().toISOString(),
        lastSaveWebsiteResponse: saveRaw,
        lastSaveWebsitePayload: {
          sendUrl: savePayload.sendUrl,
          rowId: savePayload.rowId,
        },
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
      idType: resolvedDoc.docTypeId,
      docTypeName: resolvedDoc.docTypeName,
      requireBack: resolvedDoc.requiresBack,
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
        idType: uploaded.docTypeId,
        docTypeName: uploaded.docTypeName,
        paths: uploaded.paths,
        lastTempDocumentResponses: uploaded.responses,
        identityUploadedAt: new Date().toISOString(),
        faceMatchFailed: false,
        faceMatchScore: uploaded.responses?.selfie?.score ?? null,
        faceMatchConfidence: uploaded.responses?.selfie?.confidence ?? null,
      }),
    },
  });

  const faceMatchScore = uploaded.responses?.selfie?.score ?? null;
  const faceMatchConfidence = uploaded.responses?.selfie?.confidence ?? null;
  const faceMatchOk =
    Number(faceMatchScore) > 0 || Number(faceMatchConfidence) > 0;

  const submitPayload = await buildSubmitKycPayload(customer, {
    rowIdGid,
    paths: uploaded.paths,
    idType: uploaded.docTypeId,
  });

  /** LiveEx provider bug after a good face match — do not fail the whole CIP. */
  function isLiveexSubmitKycProviderGlitch(err) {
    const msg = String(err?.message || err?.data?.message || '');
    const code = String(err?.code || err?.data?.messageCode || '');
    return (
      /IMG_SUBMIT/i.test(msg) ||
      /IMG_SUBMIT/i.test(code) ||
      /SqlTransaction has completed/i.test(msg) ||
      /no longer usable/i.test(msg)
    );
  }

  let submitRaw = null;
  let submitKycProviderError = null;
  try {
    submitRaw = await liveexSubmitKyc(submitPayload);
  } catch (submitErr) {
    if (faceMatchOk && isLiveexSubmitKycProviderGlitch(submitErr)) {
      submitKycProviderError = String(submitErr.message || submitErr);
      console.warn(
        `[LiveEx-Onboard] submit-kyc provider glitch after face match ` +
          `(${faceMatchScore ?? faceMatchConfidence}) for ${customer.id}:`,
        submitKycProviderError,
      );
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          kycData: mergeDigitalOnboarding(customer, {
            rowIdGid,
            email,
            paths: uploaded.paths,
            faceMatchFailed: false,
            faceMatchScore,
            faceMatchConfidence,
            matchConfidence:
              (Number(faceMatchScore) > 0
                ? Number(faceMatchScore)
                : null) ??
              (Number(faceMatchConfidence) > 0
                ? Number(faceMatchConfidence)
                : null),
            submitKycError: submitKycProviderError,
            submitKycErrorAt: new Date().toISOString(),
            // Soft pending until LiveEx finishes / portal clears case
            onBoardStatusId: 1,
            onBoardStatus: 'Profile Pending',
          }),
        },
      });
    } else {
      throw submitErr;
    }
  }

  const submitMatch = submitRaw?.matchConfidence;
  const bestMatch =
    (Number(submitMatch) > 0 ? Number(submitMatch) : null) ??
    (Number(faceMatchScore) > 0 ? Number(faceMatchScore) : null) ??
    (Number(faceMatchConfidence) > 0 ? Number(faceMatchConfidence) : null) ??
    (submitMatch != null ? Number(submitMatch) : null);

  if (submitRaw) {
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
  }

  // Rapidly poll LiveEx details after face match so stored onboard decision
  // matches provider (avoids approve-then-Pending when refresh runs later).
  let detailsRaw = null;
  let approval = {
    customerApproved: false,
    customerStatus: customer.status,
  };
  try {
    const polled = await pollLiveexDetailsRapidly(customer, {
      rowIdGid,
      email,
      req,
      source: 'liveex-registration-poll',
      maxAttempts: Number(options.pollAttempts) || 8,
      intervalMs: Number(options.pollIntervalMs) || 1200,
    });
    if (polled) {
      customer = polled.customer;
      detailsRaw = polled.raw;
      approval = polled.approval;
      dig = polled.digCached;
    }
  } catch (detailsErr) {
    console.warn(
      `[LiveEx-Onboard] post-submit details poll failed for ${customer.id}:`,
      detailsErr.message,
    );
    dig = extractDigitalOnboarding(customer);
    approval = await syncCustomerStatusFromLiveexOnboard(
      customer,
      customer.kycData,
      dig,
      req,
      'liveex-registration-auto',
    );
    if (approval.newlyApproved || approval.newlyPending || approval.newlyRejected) {
      customer = await prisma.customer.findUnique({ where: { id: customer.id } });
    }
  }

  const finalDig = dig || extractDigitalOnboarding(customer);

  return {
    rowIdGid,
    onBoardStatus: finalDig?.onBoardStatus ?? submitRaw?.onBoardStatus ?? 'Profile Pending',
    onBoardStatusId:
      finalDig?.onBoardStatusId ?? submitRaw?.onBoardStatusId ?? 1,
    clientNumber: finalDig?.clientNumber ?? submitRaw?.clientNumber,
    matchConfidence: finalDig?.matchConfidence ?? bestMatch,
    faceMatchScore,
    faceMatchConfidence,
    idNumber: finalDig?.idNumber ?? submitRaw?.idNumber,
    idType: submitRaw?.idType,
    paths: uploaded.paths,
    digitalOnboarding: finalDig,
    submitRaw,
    detailsRaw,
    customerApproved: approval.customerApproved,
    customerStatus: approval.customerStatus,
    pollsSettled: isLiveexDecisionSettled(finalDig),
    submitKycProviderError: submitKycProviderError || undefined,
    // Soft success even when LiveEx IMG_SUBMIT SQL glitch fired after face match
    success: true,
    faceMatchFailed: false,
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
    const rapid =
      req.body?.poll !== false &&
      req.body?.rapid !== false;
    const polled = await pollLiveexDetailsRapidly(customer, {
      rowIdGid,
      email,
      req,
      source: 'liveex-details-poll',
      maxAttempts: rapid ? Number(req.body?.pollAttempts) || 6 : 1,
      intervalMs: Number(req.body?.pollIntervalMs) || 1000,
    });
    const digOut = polled?.digCached ?? extractDigitalOnboarding(customer);
    return res.json({
      success: true,
      data: polled?.raw ?? null,
      cached: digOut,
      digitalOnboarding: digOut,
      onBoardStatusId: digOut?.onBoardStatusId ?? null,
      onBoardStatus: digOut?.onBoardStatus ?? null,
      matchConfidence: digOut?.matchConfidence ?? null,
      statusId: digOut?.statusId ?? null,
      statusLabel: digOut?.statusLabel ?? null,
      customerApproved: polled?.approval?.customerApproved ?? false,
      customerStatus: polled?.approval?.customerStatus ?? customer.status,
      pollsSettled: isLiveexDecisionSettled(digOut),
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
    let customer = await loadCustomerById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    // statusLabel "Completed" / docs+face match → approve so app stops showing incomplete
    try {
      const approval = await tryApprovePendingCustomerFromCachedStatus(customer, req);
      if (approval?.kycData != null || approval?.newlyApproved) {
        customer = await loadCustomerById(req.params.id);
      }
    } catch (err) {
      console.warn('[LiveEx-Cached] auto-approve skipped:', err.message);
    }
    return res.json({
      success: true,
      digitalOnboarding: extractDigitalOnboarding(customer),
      status: getDigitalOnboardingPublicStatus(),
      customerStatus: customer?.status ?? null,
      customerApproved: String(customer?.status || '').toLowerCase() === 'approved',
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
    // Rapid poll after face match / on Refresh so stored status matches LiveEx
    const rapid = req.body?.poll !== false;
    const polled = await pollLiveexDetailsRapidly(customer, {
      rowIdGid,
      email,
      req,
      source: 'liveex-refresh-poll',
      maxAttempts: rapid ? Number(req.body?.pollAttempts) || 8 : 1,
      intervalMs: Number(req.body?.pollIntervalMs) || 1200,
    });
    return res.json({
      success: true,
      data: polled?.raw ?? null,
      digitalOnboarding: polled?.digCached ?? dig,
      customerApproved: polled?.approval?.customerApproved ?? false,
      customerStatus: polled?.approval?.customerStatus ?? customer.status,
      pollsSettled: isLiveexDecisionSettled(polled?.digCached),
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
