import prisma from '../utils/prisma.js';
import {
  resolveAmlClientNumber,
  mapAmlCustomerStatus,
  amlGetCustomerStatus,
  amlValidateCustomer,
  amlCheckCustomerExists,
  amlSaveCustomer,
  amlClearCustomerCase,
  amlGetDocuments,
  amlUploadDocuments,
} from '../services/amlProvider.service.js';
import { buildNaturalCustomerSavePayload } from '../services/amlCustomer.builder.js';
import {
  buildAmlDocumentsUploadPayload,
  collectKycFilesForAml,
  isAmlProviderErrorResponse,
  unwrapAmlDocumentsList,
} from '../services/amlDocument.service.js';
import { extractAmlCacheFromKycData } from '../utils/amlKycData.js';
import { isUsableClientIp } from '../utils/clientIp.js';
import {
  buildClientIpFields,
  resolveLastIpForApi,
} from '../utils/resolveCustomerLastIp.js';

function mergeKycAml(customer, amlPayload) {
  const syncedAt = new Date().toISOString();
  const amlBlock = {
    mapped: amlPayload.mapped || null,
    ...(amlPayload.mapped || {}),
    clientNumber: amlPayload.clientNumber,
    lastSaveResponse: amlPayload.lastSaveResponse,
    lastStatusResponse: amlPayload.lastStatusResponse,
    lastDocumentsUploadResponse: amlPayload.lastDocumentsUploadResponse,
    lastDocumentsUploadAt: amlPayload.lastDocumentsUploadAt,
    lastCaseClearResponse: amlPayload.lastCaseClearResponse,
    ...(amlPayload.registrationIp
      ? { registrationIp: amlPayload.registrationIp }
      : {}),
    syncedAt,
  };

  const raw = customer.kycData;
  if (Array.isArray(raw)) {
    const next = raw.map((entry) => ({ ...entry }));
    const idx = next.length > 0 ? next.length - 1 : -1;
    const base = idx >= 0 ? next[idx] : {};
    const updated = {
      ...base,
      amlClientNumber: amlPayload.clientNumber || base.amlClientNumber,
      aml: { ...(base.aml || {}), ...amlBlock },
    };
    if (idx >= 0) next[idx] = updated;
    else {
      next.push({
        id: `aml_${Date.now()}`,
        verificationType: 'AML',
        ...updated,
      });
    }
    return next;
  }

  const kyc =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  kyc.amlClientNumber = amlPayload.clientNumber || kyc.amlClientNumber;
  kyc.aml = { ...(kyc.aml || {}), ...amlBlock };
  return kyc;
}

async function executeAmlOnboard(customer) {
  const resolvedBeforeSave = await resolveLastIpForApi(customer, prisma);
  if (resolvedBeforeSave && !customer.lastIpAddress) {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: { lastIpAddress: resolvedBeforeSave },
    });
  }
  const payload = buildNaturalCustomerSavePayload(customer);
  const clientNumber = payload.obj_CS_N.csClientNumber;

  console.log(`[AML] Onboarding customer ${customer.id} as ${clientNumber}…`);
  const saveRaw = await amlSaveCustomer(payload);
  if (saveRaw?.isError) {
    const err = new Error(saveRaw.message || 'AML save validation failed');
    err.status = 400;
    err.data = saveRaw;
    throw err;
  }
  const mapped = mapAmlCustomerStatus(saveRaw);
  const registrationIp = payload?.obj_CS_N?.csIPAddress;
  const kycData = mergeKycAml(customer, {
    clientNumber,
    mapped,
    lastSaveResponse: saveRaw,
    ...(isUsableClientIp(registrationIp) ? { registrationIp } : {}),
  });

  await prisma.customer.update({
    where: { id: customer.id },
    data: { kycData },
  });

  return { clientNumber, saveRaw, mapped, payload };
}

async function executeAmlDocumentUpload(customer) {
  const clientNumber = resolveAmlClientNumber(customer);
  const sources = collectKycFilesForAml(customer);
  if (sources.length === 0) {
    const err = new Error(
      'No KYC files found. Complete registration with ID, selfie, and proof of address first.',
    );
    err.status = 400;
    throw err;
  }

  const built = await buildAmlDocumentsUploadPayload(customer);
  if (built.obj_Docs.length === 0) {
    const err = new Error(
      'KYC files were found but could not be read from disk on the server.',
    );
    err.status = 400;
    err.data = { clientNumber, sources: built.sources, skipped: built.skipped };
    throw err;
  }

  console.log(
    `[AML] Uploading ${built.obj_Docs.length} document(s) for ${clientNumber}…`,
  );
  const uploadRaw = await amlUploadDocuments(built.payload);
  if (isAmlProviderErrorResponse(uploadRaw)) {
    const err = new Error(uploadRaw.message || 'AML document upload failed');
    err.status = 400;
    err.data = uploadRaw;
    throw err;
  }

  let documents = [];
  try {
    const listRaw = await amlGetDocuments(clientNumber);
    documents = unwrapAmlDocumentsList(listRaw);
  } catch (listErr) {
    console.warn('[AML] upload ok but list failed:', listErr.message);
  }

  const kycData = mergeKycAml(customer, {
    clientNumber,
    lastDocumentsUploadResponse: uploadRaw,
    lastDocumentsUploadAt: new Date().toISOString(),
  });
  await prisma.customer.update({
    where: { id: customer.id },
    data: { kycData },
  });

  return {
    clientNumber,
    uploadedCount: built.obj_Docs.length,
    skipped: built.skipped,
    upload: uploadRaw,
    documents,
  };
}

async function loadCustomer(id) {
  return prisma.customer.findUnique({ where: { id } });
}

export const getCustomerAmlStatus = async (req, res) => {
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const clientNumber = resolveAmlClientNumber(customer);
    let existsResponse = null;
    try {
      existsResponse = await amlCheckCustomerExists(clientNumber);
    } catch (e) {
      existsResponse = { error: e.message, data: e.data };
    }

    const amlRaw = await amlGetCustomerStatus(clientNumber);
    const mapped = mapAmlCustomerStatus(amlRaw);

    const kycData = mergeKycAml(customer, {
      clientNumber,
      mapped,
      lastStatusResponse: amlRaw,
    });

    await prisma.customer.update({
      where: { id: customer.id },
      data: { kycData },
    });

    console.log(
      `[AML] Customer ${customer.id} status → ${mapped.statusLabel} (client: ${clientNumber})`,
    );

    const customerWithKyc = { ...customer, kycData };
    const amlCache = extractAmlCacheFromKycData(kycData);
    const lastIpAddress = await resolveLastIpForApi(customerWithKyc, prisma, [
      amlRaw,
      existsResponse,
    ]);

    return res.json({
      success: true,
      message: 'AML status retrieved',
      data: {
        customerId: customer.id,
        clientNumber,
        exists: existsResponse,
        aml: amlRaw,
        status: mapped,
        mapped,
        cachedAt: amlCache?.syncedAt ?? null,
        ...buildClientIpFields(lastIpAddress),
      },
    });
  } catch (error) {
    console.error('[AML] getCustomerAmlStatus:', error.message);
    return res.status(502).json({
      success: false,
      message: error.message || 'Failed to fetch AML status',
      error: error.data || undefined,
      amlProviderReachable: error.status !== undefined,
    });
  }
};

export const runCustomerAmlValidation = async (req, res) => {
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const clientNumber = resolveAmlClientNumber(customer);

    console.log(`[AML] Running validation for ${clientNumber}…`);
    const validateRaw = await amlValidateCustomer(clientNumber);
    const mappedValidate = mapAmlCustomerStatus(validateRaw);

    let statusRaw = validateRaw;
    try {
      statusRaw = await amlGetCustomerStatus(clientNumber);
    } catch {
      /* validate response may already include status */
    }
    const mapped = mapAmlCustomerStatus(statusRaw);

    const kycData = mergeKycAml(customer, {
      clientNumber,
      mapped: mappedValidate.statusId ? mappedValidate : mapped,
      lastValidateResponse: validateRaw,
      lastStatusResponse: statusRaw,
    });

    await prisma.customer.update({
      where: { id: customer.id },
      data: { kycData },
    });

    console.log(
      `[AML] Validation done — ${mappedValidate.statusLabel || mapped.statusLabel}`,
    );

    const amlCache = extractAmlCacheFromKycData(kycData);
    const lastIpAddress = await resolveLastIpForApi(
      { ...customer, kycData },
      prisma,
      [validateRaw, statusRaw],
    );

    return res.json({
      success: true,
      message: 'AML validation completed',
      data: {
        customerId: customer.id,
        clientNumber,
        validate: validateRaw,
        status: statusRaw,
        mapped: mappedValidate.statusId ? mappedValidate : mapped,
        cachedAt: amlCache?.syncedAt ?? null,
        ...buildClientIpFields(lastIpAddress),
      },
    });
  } catch (error) {
    console.error('[AML] runCustomerAmlValidation:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'AML validation failed',
      error: error.data || undefined,
    });
  }
};

export const onboardCustomerToAml = async (req, res) => {
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const result = await executeAmlOnboard(customer);

    return res.json({
      success: true,
      message: 'Customer submitted to AML provider',
      data: {
        customerId: customer.id,
        clientNumber: result.clientNumber,
        save: result.saveRaw,
        mapped: result.mapped,
        payload: result.payload,
      },
    });
  } catch (error) {
    console.error('[AML] onboardCustomerToAml:', error.message, error.data?.errors || '');
    return res.status(error.status === 400 ? 400 : 500).json({
      success: false,
      message: error.message || 'AML onboarding failed',
      error: error.data || undefined,
      validationErrors: error.data?.errors || undefined,
    });
  }
};

export const clearCustomerAmlCase = async (req, res) => {
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const { remarks } = req.body;
    if (!remarks?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Remarks are required to clear AML case',
      });
    }

    const clientNumber = resolveAmlClientNumber(customer);
    const clearRaw = await amlClearCustomerCase(clientNumber, remarks.trim());
    const statusRaw = await amlGetCustomerStatus(clientNumber);
    const mapped = mapAmlCustomerStatus(statusRaw);

    const kycData = mergeKycAml(customer, {
      clientNumber,
      mapped,
      lastCaseClearResponse: clearRaw,
      lastStatusResponse: statusRaw,
    });

    await prisma.customer.update({
      where: { id: customer.id },
      data: { kycData },
    });

    return res.json({
      success: true,
      message: 'AML case cleared',
      data: { clientNumber, clear: clearRaw, status: statusRaw, mapped },
    });
  } catch (error) {
    console.error('[AML] clearCustomerAmlCase:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to clear AML case',
      error: error.data || undefined,
    });
  }
};

export const getCustomerAmlDocuments = async (req, res) => {
  let clientNumber = '';
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    clientNumber = resolveAmlClientNumber(customer);
    const searchValue =
      typeof req.query.search === 'string' ? req.query.search : '';
    const docsRaw = await amlGetDocuments(clientNumber, searchValue);
    const documents = unwrapAmlDocumentsList(docsRaw);
    return res.json({
      success: true,
      message: 'AML documents retrieved',
      data: {
        clientNumber,
        documents,
        provider: docsRaw,
      },
    });
  } catch (error) {
    console.error('[AML] getCustomerAmlDocuments:', error.message);
    if (error.status === 404) {
      return res.json({
        success: true,
        message: 'No AML documents found for this client',
        data: { clientNumber, documents: [] },
      });
    }
    return res.status(error.status && error.status < 500 ? error.status : 502).json({
      success: false,
      message: error.message || 'Failed to fetch AML documents',
      error: error.data || undefined,
    });
  }
};

export const uploadCustomerAmlDocuments = async (req, res) => {
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const result = await executeAmlDocumentUpload(customer);

    return res.json({
      success: true,
      message: result.upload?.message || 'AML documents uploaded',
      data: result,
    });
  } catch (error) {
    console.error('[AML] uploadCustomerAmlDocuments:', error.message);
    return res.status(error.status === 400 ? 400 : 502).json({
      success: false,
      message: error.message || 'Failed to upload AML documents',
      error: error.data || undefined,
    });
  }
};

export const previewCustomerAmlDocuments = async (req, res) => {
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const sources = collectKycFilesForAml(customer);
    return res.json({
      success: true,
      data: {
        clientNumber: resolveAmlClientNumber(customer),
        sources,
        count: sources.length,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to preview KYC sources',
    });
  }
};

/** Mobile app: POST /api/accounts/aml/onboard — submit authenticated customer to AML */
export const customerAmlOnboard = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const customer = await loadCustomer(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const result = await executeAmlOnboard(customer);
    return res.json({
      success: true,
      message: 'Customer submitted to AML provider',
      data: {
        clientNumber: result.clientNumber,
        save: result.saveRaw,
        mapped: result.mapped,
      },
    });
  } catch (error) {
    console.error('[AML] customerAmlOnboard:', error.message);
    return res.status(error.status === 400 ? 400 : 502).json({
      success: false,
      message: error.message || 'AML onboarding failed',
      error: error.data || undefined,
    });
  }
};

/** Mobile app: POST /api/accounts/aml/documents/upload — upload registration KYC docs to AML */
export const customerAmlUploadDocuments = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const customer = await loadCustomer(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const result = await executeAmlDocumentUpload(customer);
    return res.json({
      success: true,
      message: result.upload?.message || 'AML documents uploaded',
      data: result,
    });
  } catch (error) {
    console.error('[AML] customerAmlUploadDocuments:', error.message);
    return res.status(error.status === 400 ? 400 : 502).json({
      success: false,
      message: error.message || 'Failed to upload AML documents',
      error: error.data || undefined,
    });
  }
};

/** Mobile app: POST /api/accounts/aml-sync — onboard + upload documents in one call */
export const customerAmlSync = async (req, res) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    let customer = await loadCustomer(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const onboard = await executeAmlOnboard(customer);
    customer = await loadCustomer(customerId);
    const documents = await executeAmlDocumentUpload(customer);

    return res.json({
      success: true,
      message: 'AML sync completed',
      amlSync: { onboard, documents },
    });
  } catch (error) {
    console.error('[AML] customerAmlSync:', error.message);
    return res.status(error.status === 400 ? 400 : 502).json({
      success: false,
      message: error.message || 'AML sync failed',
      amlSyncError: error.message,
      error: error.data || undefined,
    });
  }
};

export const getCustomerAmlCached = async (req, res) => {
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const aml = extractAmlCacheFromKycData(customer.kycData);
    const lastIpAddress = await resolveLastIpForApi(customer, prisma, [
      aml?.lastStatusResponse,
      aml?.lastSaveResponse,
    ]);

    return res.json({
      success: true,
      message: aml ? 'Cached AML data' : 'No AML data cached yet',
      data: {
        customerId: customer.id,
        clientNumber: aml?.clientNumber || resolveAmlClientNumber(customer),
        aml,
        cachedAt: aml?.syncedAt ?? null,
        ...buildClientIpFields(lastIpAddress),
      },
    });
  } catch (error) {
    console.error('[AML] getCustomerAmlCached:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to load cached AML data',
    });
  }
};
