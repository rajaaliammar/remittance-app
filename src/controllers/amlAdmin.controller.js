import prisma from '../utils/prisma.js';
import {
  amlListCustomers,
  amlCheckCustomerExists,
  amlGetCustomerStatus,
  amlGetDocuments,
  amlUpdateCustomerName,
  mapAmlCustomerStatus,
  resolveAmlClientNumber,
  CUSTOMER_STATUS_LABELS,
} from '../services/amlProvider.service.js';
import {
  unwrapAmlDocumentsList,
  findLocalFileForAmlDocument,
  findCustomerByAmlClientNumber,
} from '../services/amlDocument.service.js';
import { amlFetchDocumentBinary } from '../services/amlProvider.service.js';
import fs from 'fs';
import path from 'path';
import { extractAmlCacheFromKycData } from '../utils/amlKycData.js';

function isAmlProviderNotFound(raw) {
  const msg = String(raw?.message || '').toLowerCase();
  return Boolean(raw?.isError) && msg.includes('does not exist');
}

function looksLikeAmlClientNumber(value) {
  const v = String(value || '').trim();
  return /^CS[_-]/i.test(v) || /^TRCUSTOMER_/i.test(v);
}

function normalizeListingRow(row, index) {
  if (!row || typeof row !== 'object') {
    return {
      key: `row-${index}`,
      pin: '',
      status: '',
      statusId: null,
      clientNumber: '',
    };
  }
  const pin = String(row.Pin ?? row.pin ?? '').trim();
  const clientNumber = String(
    row.clientNumber ?? row.ClientNumber ?? row.csClientNumber ?? row.CsClientNumber ?? '',
  ).trim();
  const statusIdRaw = row.statusId ?? row.StatusId ?? null;
  const statusId =
    statusIdRaw === null || statusIdRaw === undefined || statusIdRaw === ''
      ? null
      : parseInt(String(statusIdRaw), 10);
  const status =
    row.status ||
    row.Status ||
    (statusId && CUSTOMER_STATUS_LABELS[statusId]) ||
    '';

  return {
    key: pin || clientNumber || `row-${index}`,
    pin,
    status,
    statusId: Number.isNaN(statusId) ? null : statusId,
    clientNumber,
  };
}

/** GET /api/aml/customers/resolve?pin= | ?identifier= */
export const resolveAmlCustomerIdentifier = async (req, res) => {
  try {
    const identifier = String(req.query.pin || req.query.identifier || '').trim();
    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: 'pin or identifier query is required',
      });
    }

    if (looksLikeAmlClientNumber(identifier)) {
      const linked = await findCustomerByAmlClientNumber(identifier, prisma);
      return res.json({
        success: true,
        data: {
          pin: null,
          clientNumber: identifier,
          localCustomerId: linked?.id ?? null,
          source: linked ? 'database' : 'identifier',
        },
      });
    }

    const pin = identifier;
    const pattern = `%${pin}%`;
    const rows = await prisma.$queryRaw`
      SELECT id, email, "firstName", "lastName", "kycData"
      FROM customers
      WHERE "kycData"::text LIKE ${pattern}
      ORDER BY "updatedAt" DESC NULLS LAST
      LIMIT 25
    `;

    for (const row of rows) {
      const customer = {
        id: row.id,
        kycData: row.kycData,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
      };
      const cache = extractAmlCacheFromKycData(customer.kycData);
      const clientNumber =
        cache?.clientNumber || resolveAmlClientNumber(customer);
      const cachedPin = String(cache?.mapped?.pin ?? '').trim();
      const statusPin = String(
        cache?.lastStatusResponse?.Pin ??
          cache?.lastStatusResponse?.pin ??
          '',
      ).trim();

      if (cachedPin === pin || statusPin === pin) {
        return res.json({
          success: true,
          data: {
            pin,
            clientNumber,
            localCustomerId: customer.id,
            localCustomerEmail: customer.email,
            source: 'database',
          },
        });
      }
    }

    return res.json({
      success: true,
      data: {
        pin,
        clientNumber: null,
        localCustomerId: null,
        source: 'unresolved',
        hint:
          'Listing PIN is not the AML client number. Enter CS_… from onboarding or open the customer profile.',
      },
    });
  } catch (error) {
    console.error('[AML Admin] resolveAmlCustomerIdentifier:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to resolve AML identifier',
    });
  }
};

function normalizeListingResponse(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normalizeListingRow);
  const list =
    raw.customerListingResponse ||
    raw.CustomerListingResponse ||
    raw.data ||
    [];
  if (!Array.isArray(list)) return [];
  return list.map(normalizeListingRow);
}

function providerError(res, raw, fallbackMessage) {
  if (raw?.isError) {
    return res.status(400).json({
      success: false,
      message: raw.message || fallbackMessage,
      messageCode: raw.messageCode,
      messageDetails: raw.messageDetails,
      provider: raw,
    });
  }
  return null;
}

/** GET /api/aml/customers/listing?startDate=&endDate= */
export const listAmlCustomers = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const raw = await amlListCustomers(startDate, endDate);
    const err = providerError(res, raw, 'AML customer listing failed');
    if (err) return err;

    const listing = normalizeListingResponse(raw);
    return res.json({
      success: true,
      message: raw?.message || 'AML customers retrieved',
      data: { listing, provider: raw },
    });
  } catch (error) {
    console.error('[AML Admin] listAmlCustomers:', error.message);
    return res.status(502).json({
      success: false,
      message: error.message || 'Failed to fetch AML customer listing',
      error: error.data || undefined,
    });
  }
};

/** GET /api/aml/customers/:clientNumber/exists */
export const checkAmlCustomerExists = async (req, res) => {
  try {
    const clientNumber = decodeURIComponent(req.params.clientNumber || '').trim();
    if (!clientNumber) {
      return res.status(400).json({
        success: false,
        message: 'Client number is required',
      });
    }

    const raw = await amlCheckCustomerExists(clientNumber);
    let exists = false;
    if (raw === true || raw === false) {
      exists = raw;
    } else if (raw && typeof raw === 'object' && 'exists' in raw) {
      exists = Boolean(raw.exists);
    } else {
      exists = Boolean(raw);
    }

    return res.json({
      success: true,
      data: { clientNumber, exists, provider: raw },
    });
  } catch (error) {
    console.error('[AML Admin] checkAmlCustomerExists:', error.message);
    return res.status(502).json({
      success: false,
      message: error.message || 'Failed to check AML customer existence',
      error: error.data || undefined,
    });
  }
};

/** GET /api/aml/customers/:clientNumber/status */
export const getAmlCustomerStatus = async (req, res) => {
  try {
    const clientNumber = decodeURIComponent(req.params.clientNumber || '').trim();
    if (!clientNumber) {
      return res.status(400).json({
        success: false,
        message: 'Client number is required',
      });
    }

    const statusRaw = await amlGetCustomerStatus(clientNumber);
    if (isAmlProviderNotFound(statusRaw)) {
      return res.json({
        success: true,
        data: {
          clientNumber,
          status: statusRaw,
          mapped: null,
          notFound: true,
          message: statusRaw.message,
        },
      });
    }

    const err = providerError(res, statusRaw, 'Failed to fetch AML status');
    if (err) return err;

    const mapped = mapAmlCustomerStatus(statusRaw);
    return res.json({
      success: true,
      data: {
        clientNumber,
        status: statusRaw,
        mapped,
        notFound: false,
      },
    });
  } catch (error) {
    console.error('[AML Admin] getAmlCustomerStatus:', error.message);
    return res.status(502).json({
      success: false,
      message: error.message || 'Failed to fetch AML customer status',
      error: error.data || undefined,
    });
  }
};

/** GET /api/aml/customers/:clientNumber/documents */
export const getAmlCustomerDocuments = async (req, res) => {
  try {
    const clientNumber = decodeURIComponent(req.params.clientNumber || '').trim();
    const searchValue = String(req.query.searchValue || '').trim();
    if (!clientNumber) {
      return res.status(400).json({
        success: false,
        message: 'Client number is required',
      });
    }

    const docsRaw = await amlGetDocuments(clientNumber, searchValue);
    const err = providerError(res, docsRaw, 'Failed to fetch AML documents');
    if (err) return err;

    const documents = unwrapAmlDocumentsList(docsRaw);
    return res.json({
      success: true,
      data: {
        clientNumber,
        documents,
        provider: docsRaw,
      },
    });
  } catch (error) {
    console.error('[AML Admin] getAmlCustomerDocuments:', error.message);
    return res.status(502).json({
      success: false,
      message: error.message || 'Failed to fetch AML documents',
      error: error.data || undefined,
    });
  }
};

function findAmlDocInList(documents, docId) {
  return documents.find(
    (doc) => String(doc.doc_ID ?? doc.docId ?? '') === String(docId),
  );
}

function mimeFromFileName(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

/** GET /api/aml/customers/:clientNumber/documents/:docId/view */
export const viewAmlCustomerDocument = async (req, res) => {
  try {
    const clientNumber = decodeURIComponent(req.params.clientNumber || '').trim();
    const docId = decodeURIComponent(req.params.docId || '').trim();
    const localCustomerId = String(req.query.localCustomerId || '').trim();
    const hintName = String(req.query.fileName || '').trim();
    const hintPath = String(req.query.filepath || '').trim();

    if (!clientNumber || !docId) {
      return res.status(400).json({
        success: false,
        message: 'Client number and document ID are required',
      });
    }

    let docRecord = null;
    try {
      const docsRaw = await amlGetDocuments(clientNumber);
      if (!docsRaw?.isError) {
        const documents = unwrapAmlDocumentsList(docsRaw);
        docRecord = findAmlDocInList(documents, docId);
      }
    } catch (listErr) {
      console.warn('[AML Admin] view: document list lookup failed:', listErr.message);
    }

    const fileName =
      (docRecord?.doc_name ?? docRecord?.docs_Name ?? hintName) ||
      `document-${docId}`;
    const filepath =
      docRecord?.filepath ?? docRecord?.docs_Filepath ?? hintPath ?? '';

    let customer =
      localCustomerId &&
      (await prisma.customer.findUnique({ where: { id: localCustomerId } }));

    if (!customer) {
      customer = await findCustomerByAmlClientNumber(clientNumber, prisma);
    }

    const localPath = customer
      ? findLocalFileForAmlDocument(customer, fileName, filepath, docRecord)
      : findLocalFileForAmlDocument(
          { kycData: [] },
          fileName,
          filepath,
          docRecord,
        );

    if (localPath && fs.existsSync(localPath)) {
      const serveName = path.basename(localPath);
      res.setHeader('Content-Type', mimeFromFileName(serveName));
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${serveName}"`,
      );
      return res.sendFile(path.resolve(localPath));
    }

    const remote = await amlFetchDocumentBinary(filepath, fileName);
    if (remote?.buffer) {
      res.setHeader('Content-Type', remote.contentType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${path.basename(String(fileName))}"`,
      );
      return res.send(remote.buffer);
    }

    return res.status(404).json({
      success: false,
      message: customer
        ? 'Document file is not on this server. Re-upload KYC from the customer profile, or open the file from Customer → AML tab.'
        : 'Document file is not available. Link this AML PIN to a portal customer (Open profile) and ensure KYC files were uploaded.',
    });
  } catch (error) {
    console.error('[AML Admin] viewAmlCustomerDocument:', error.message);
    return res.status(502).json({
      success: false,
      message: error.message || 'Failed to load document for viewing',
    });
  }
};

/** PUT /api/aml/customers/:clientNumber/name */
export const updateAmlCustomerName = async (req, res) => {
  try {
    const clientNumber = decodeURIComponent(req.params.clientNumber || '').trim();
    const { givenName, surname, otherInitial } = req.body || {};

    if (!clientNumber) {
      return res.status(400).json({
        success: false,
        message: 'Client number is required',
      });
    }
    if (!givenName?.trim() || !surname?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Given name and surname are required',
      });
    }

    const raw = await amlUpdateCustomerName(clientNumber, {
      givenName: givenName.trim(),
      surname: surname.trim(),
      otherInitial: otherInitial?.trim() || '',
    });
    const err = providerError(res, raw, 'Failed to update AML customer name');
    if (err) return err;

    return res.json({
      success: true,
      message: raw?.message || 'Customer name updated',
      data: { clientNumber, provider: raw },
    });
  } catch (error) {
    console.error('[AML Admin] updateAmlCustomerName:', error.message);
    return res.status(502).json({
      success: false,
      message: error.message || 'Failed to update AML customer name',
      error: error.data || undefined,
    });
  }
};
