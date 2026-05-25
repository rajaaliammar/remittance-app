import {
  toAmlDate,
  toAmlDateTime,
  resolveAmlClientNumber,
} from './amlProvider.service.js';
import { buildNaturalCustomerSavePayload } from './amlCustomer.builder.js';
import {
  normalizeCountryCode,
  resolveSourceOfFund,
  formatAmlPhone,
} from './amlFieldCodes.js';
import {
  AML_NA,
  buildDefaultObjTR,
  buildDefaultObjBNI,
} from './amlTransaction.defaults.js';

function mapAmlCurrencyCode(currency) {
  const c = String(currency || 'USD').trim().toUpperCase();
  if (c.length === 3) return c;
  return 'USD';
}

function splitName(full) {
  const parts = String(full || 'Beneficiary Unknown').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { given: 'Beneficiary', surname: 'Unknown' };
  return { given: parts[0], surname: parts.slice(1).join(' ') || parts[0] };
}

function resolvePurposeCode(recipientInfo) {
  const text = String(
    recipientInfo?.sendingPurpose || recipientInfo?.purpose || '',
  ).toLowerCase();
  if (text.includes('family')) return 4;
  if (text.includes('education')) return 45;
  const env = parseInt(process.env.AML_DEFAULT_TR_PURPOSE || '60', 10);
  return Number.isNaN(env) ? 60 : env;
}

/**
 * Build LiveEx POST /api/Transactions/save body (FullTransactionDto).
 */
export function buildRemittanceTransactionSavePayload({
  customer,
  transaction,
  recipientInfo = {},
  reqMeta = {},
  /** When true, send full natural customer with csIsUpdate (existing TMS customer). */
  customerIsExisting = true,
}) {
  const natural = buildNaturalCustomerSavePayload(customer);
  const clientNumber = natural.obj_CS_N?.csClientNumber || resolveAmlClientNumber(customer);
  const txAt = new Date(transaction.createdAt || Date.now());
  const today = toAmlDateTime(txAt);
  const todayDateOnly = toAmlDate(txAt);
  const issue = toAmlDate(new Date());
  const expiry = toAmlDate(
    new Date(new Date().getFullYear() + 10, new Date().getMonth(), new Date().getDate()),
  );

  const internalRef =
    String(process.env.AML_TR_REF_PREFIX || 'REM').trim() + `-${transaction.id}`;

  const ri = recipientInfo && typeof recipientInfo === 'object' ? recipientInfo : {};
  const { given: bGiven, surname: bSur } = splitName(
    ri.accountHolderName || ri.name || 'Beneficiary',
  );
  const destCountry = normalizeCountryCode(
    ri.country || ri.countryCode || ri.destinationCountry || customer.country || 'US',
  );
  const senderCountry = normalizeCountryCode(customer.country || 'US');
  const sendAmount = Number(transaction.sendAmount) || 0;
  const currency = mapAmlCurrencyCode(transaction.currency);
  const senderAddr =
    customer.address || customer.city || 'Not Provided';
  const senderCity = customer.city || 'Unknown';
  const senderRegion = customer.region || 'NA';
  const senderZip = customer.zipCode || '00000';
  const recvAddr = String(ri.address || ri.accountNumber || senderAddr).slice(0, 200);

  const beneficiaryKey =
    ri.beneficiaryKey ||
    (ri.accountNumber
      ? `ext:${String(ri.accountNumber).trim()}`
      : `ext:${bGiven}:${bSur}`.toLowerCase());

  const obj_TR = {
    ...buildDefaultObjTR(),
    cS_CLIENT_NUMBER: clientNumber,
    tR_DATE: today,
    tR_DATE_OF_POSTING: today,
    tR_INTERNAL_REFERENCE_NO: internalRef,
    tR_PRODUCT_TYPE: parseInt(process.env.AML_DEFAULT_TR_PRODUCT_TYPE || '97', 10),
    tR_SOURCE_OF_FUND: resolveSourceOfFund(
      ri.sourceOfFund || customer.sourceOfFund || 'Salary',
    ),
    tR_CHANNEL: parseInt(process.env.AML_DEFAULT_TR_CHANNEL || '2', 10),
    tR_PURPOSE: resolvePurposeCode(ri),
    tR_DETAILS_OF_FUND: parseInt(process.env.AML_DEFAULT_TR_DETAILS_OF_FUND || '21', 10),
    tR_DISPOSITION_OF_FUND: parseInt(
      process.env.AML_DEFAULT_TR_DISPOSITION_OF_FUND || '13',
      10,
    ),
    tR_CURRENCY: currency,
    tR_RATE:
      transaction.exchangeRate != null
        ? String(Number(transaction.exchangeRate).toFixed(6))
        : '1',
    tR_AMOUNT_FC: String(sendAmount),
    tR_CONDUCTED_MODE: parseInt(process.env.AML_DEFAULT_TR_CONDUCTED_MODE || '17', 10),
    tR_METHODE_OF_TRANSACTION: 2,
    tR_REFERENCE_NO: internalRef,
    tR_IP_ADDRESS: reqMeta.ipAddress || transaction.ipAddress || '0.0.0.0',
    tR_DEVICE_IDENTIFIER_NO: reqMeta.deviceId || transaction.deviceId || AML_NA,
    tR_TYPE_OF_DEVICE_USED: 2,
    TR_PROPERTY_TYPE_OF_CURRENCY: currency,
  };

  const recvName = `${bGiven} ${bSur}`.trim();
  obj_TR.tR_DESCRIPTION = [
    `OneZa remittance ${transaction.id}`,
    recvName !== 'Beneficiary Unknown' ? `Beneficiary: ${recvName}` : '',
    ri.accountNumber ? `Account: ${ri.accountNumber}` : '',
    destCountry ? `Dest: ${destCountry}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
  obj_TR.TR_RECIEVER_ADDRESS_1 = recvAddr;
  obj_TR.TR_SENDER_ADDRESS_1 = senderAddr;

  const obj_CS_N = { ...natural.obj_CS_N, csClientNumber: clientNumber };
  if (customerIsExisting) {
    obj_CS_N.csIsUpdate = true;
  }

  // LiveEx rejects save when obj_BNI.bni_ClientNumber is set alongside sender cs/cS
  // client numbers ("Multiple Client Number Found"). Recipient is in TR fields above.
  const body = {
    nCUSTOMER_TYPE: 1,
    obj_CS_N,
    obj_TR: { ...obj_TR, tR_IsUPDATE: false },
    _meta: { clientNumber, internalRef, beneficiaryKey, recipientName: recvName },
  };

  if (process.env.AML_TRANSACTION_INCLUDE_BENEFICIARY === 'true') {
    const bniNumber = `BNI${String(beneficiaryKey)
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 20)
      .toUpperCase()}`;
    body.obj_BNI = {
      ...buildDefaultObjBNI({
        bni_ClientNumber: bniNumber,
        bni_GivenName: bGiven,
        bni_Surname: bSur,
        bni_OtherOrInitial: 'N',
        bni_DateOfBirth: toAmlDate(new Date('1990-01-01')),
        bni_CountryOfCitizenship: destCountry,
        bni_Country: destCountry,
        bni_DualNationality: destCountry,
        bni_PlaceOfBirth: destCountry,
        bni_HomeTelephoneNumber: formatAmlPhone(ri.phone || '0000000000', destCountry),
        bni_BusinessTelephoneNumber: formatAmlPhone(ri.phone || '0000000000', destCountry),
        bni_Identifier: 5,
        bni_IdentifierNumber: String(ri.accountNumber || internalRef).slice(0, 40),
        bni_StreetAddress: recvAddr,
        bni_City: String(ri.city || customer.city || 'Unknown'),
        bni_ProvinceOrState: String(ri.region || customer.region || 'NA'),
        bni_PostalOrZipCode: String(ri.zipCode || customer.zipCode || '00000'),
        bni_JurisdictionIssueCountry: destCountry,
        bni_JurisdictionIssueState: senderRegion,
        bni_IssueDate: issue,
        bni_ExpiryDate: expiry,
        _today: todayDateOnly,
      }),
      bni_IsUpdate: false,
    };
  }

  return body;
}

export function extractAmlSaveResult(saveRaw) {
  if (!saveRaw || typeof saveRaw !== 'object') {
    return { trIdDisplay: null, internalRef: null, status: null, statusId: null };
  }
  return {
    trIdDisplay:
      saveRaw.tR_ID_DISPLAY ??
      saveRaw.trDisplayId ??
      saveRaw.transaction_Number ??
      null,
    internalRef:
      saveRaw.tR_INTERNAL_REFERENCE_NO ??
      saveRaw.tR_Internal_Referance_Number ??
      null,
    status: saveRaw.tR_Status ?? saveRaw.trStatus ?? null,
    statusId:
      saveRaw.tR_StatusID != null
        ? parseInt(String(saveRaw.tR_StatusID), 10)
        : saveRaw.trStatusId ?? null,
    message: saveRaw.message ?? null,
    isError: Boolean(saveRaw.isError),
    messageCode: saveRaw.messageCode ?? null,
    raw: saveRaw,
  };
}
