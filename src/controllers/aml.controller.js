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
  unwrapAmlDocumentsList,
} from '../services/amlDocument.service.js';

function mergeKycAml(customer, amlPayload) {
  const kyc =
    customer.kycData && typeof customer.kycData === 'object'
      ? { ...customer.kycData }
      : {};
  kyc.amlClientNumber = amlPayload.clientNumber || kyc.amlClientNumber;
  kyc.aml = {
    ...(kyc.aml || {}),
    ...amlPayload,
    syncedAt: new Date().toISOString(),
  };
  return kyc;
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
        cachedAt: kycData.aml.syncedAt,
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

    return res.json({
      success: true,
      message: 'AML validation completed',
      data: {
        customerId: customer.id,
        clientNumber,
        validate: validateRaw,
        status: statusRaw,
        mapped: mappedValidate.statusId ? mappedValidate : mapped,
        cachedAt: kycData.aml.syncedAt,
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

    const kycData = mergeKycAml(customer, {
      clientNumber,
      mapped,
      lastSaveResponse: saveRaw,
    });

    await prisma.customer.update({
      where: { id: customer.id },
      data: { kycData },
    });

    return res.json({
      success: true,
      message: 'Customer submitted to AML provider',
      data: {
        customerId: customer.id,
        clientNumber,
        save: saveRaw,
        mapped,
        payload,
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

    const clientNumber = resolveAmlClientNumber(customer);
    const sources = collectKycFilesForAml(customer);
    if (sources.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          'No KYC files found for this customer. Complete registration/KYC in the app first (ID, selfie, proof of address).',
        data: { clientNumber, sources: [] },
      });
    }

    const built = await buildAmlDocumentsUploadPayload(customer);
    if (built.obj_Docs.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          'KYC files were found but could not be read from disk. Ensure files exist under /uploads/kyc on the backend server.',
        data: {
          clientNumber,
          sources: built.sources,
          skipped: built.skipped,
        },
      });
    }

    console.log(
      `[AML] Uploading ${built.obj_Docs.length} document(s) for ${clientNumber}…`,
    );
    const uploadRaw = await amlUploadDocuments(built.payload);
    if (uploadRaw?.isError) {
      const err = new Error(uploadRaw.message || 'AML document upload failed');
      err.status = 400;
      err.data = uploadRaw;
      throw err;
    }

    let listRaw = null;
    let documents = [];
    try {
      listRaw = await amlGetDocuments(clientNumber);
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

    return res.json({
      success: true,
      message: uploadRaw?.message || 'AML documents uploaded',
      data: {
        clientNumber,
        uploadedCount: built.obj_Docs.length,
        skipped: built.skipped,
        upload: uploadRaw,
        documents,
      },
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

export const getCustomerAmlCached = async (req, res) => {
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const kyc =
      customer.kycData && typeof customer.kycData === 'object'
        ? customer.kycData
        : {};
    const aml = kyc.aml || null;

    return res.json({
      success: true,
      message: aml ? 'Cached AML data' : 'No AML data cached yet',
      data: {
        customerId: customer.id,
        clientNumber: resolveAmlClientNumber(customer),
        aml,
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
