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
} from '../services/amlProvider.service.js';
import { buildNaturalCustomerSavePayload } from '../services/amlCustomer.builder.js';

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
    console.error('[AML] onboardCustomerToAml:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'AML onboarding failed',
      error: error.data || undefined,
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
  try {
    const customer = await loadCustomer(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    const clientNumber = resolveAmlClientNumber(customer);
    const docs = await amlGetDocuments(clientNumber);
    return res.json({
      success: true,
      message: 'AML documents retrieved',
      data: { clientNumber, documents: docs },
    });
  } catch (error) {
    console.error('[AML] getCustomerAmlDocuments:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch AML documents',
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
