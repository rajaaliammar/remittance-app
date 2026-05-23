import { toAmlDate, resolveAmlClientNumber } from './amlProvider.service.js';
import {
  AML_DEFAULTS,
  normalizeCountryCode,
  resolveClientLocation,
  resolveIdentifierType,
  resolveOccupationCode,
  resolveProfessionId,
  resolveSourceOfFund,
  formatAmlPhone,
} from './amlFieldCodes.js';

function pickKycField(kyc, ...keys) {
  for (const key of keys) {
    const val = kyc?.[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return null;
}

/**
 * Build AML Natural Person save payload from Remittance Customer record.
 * LiveEx TMS expects integer lookup codes for coded fields (not free text).
 */
export function buildNaturalCustomerSavePayload(customer) {
  const clientNumber = resolveAmlClientNumber(customer);
  const dob = customer.dateOfBirth
    ? new Date(customer.dateOfBirth)
    : new Date('1990-01-01');
  const todayDate = new Date();
  const issueDate = new Date(todayDate);
  issueDate.setFullYear(issueDate.getFullYear() - 1);
  const today = toAmlDate(todayDate);
  const issue = toAmlDate(issueDate);
  const expiry = toAmlDate(
    new Date(todayDate.getFullYear() + 10, todayDate.getMonth(), todayDate.getDate()),
  );

  const kyc =
    customer.kycData && typeof customer.kycData === 'object'
      ? customer.kycData
      : {};

  const countryCode = normalizeCountryCode(
    customer.country || customer.nationality || customer.residentCountry || 'US',
  );
  const citizenship = normalizeCountryCode(
    customer.nationality || kyc.citizenship || countryCode,
  );

  const identifier =
    pickKycField(kyc, 'ssn', 'government_id', 'cnic', 'passportNumber', 'passport', 'documentNumber') ||
    clientNumber;

  const streetAddress =
    customer.address ||
    pickKycField(kyc, 'address', 'street_address') ||
    'Not Provided';
  const postalCode = customer.zipCode || pickKycField(kyc, 'zipCode', 'zip_code') || '00000';
  const city = customer.city || pickKycField(kyc, 'city') || 'Unknown';
  const region = customer.region || pickKycField(kyc, 'region', 'state') || 'NA';
  const profession = customer.occupation || pickKycField(kyc, 'occupation', 'profession') || 'Other';
  const phoneRaw = customer.phone || customer.telephone || '0000000000';
  const phone = formatAmlPhone(phoneRaw, countryCode);
  const ssn = pickKycField(kyc, 'ssn') || (countryCode === 'US' ? String(identifier).replace(/-/g, '') : 'N/A');
  const employerName = pickKycField(kyc, 'employer') || profession || 'Self Employed';

  const obj_CS_N = {
    csClientNumber: clientNumber,
    csGivenName: customer.firstName || 'Unknown',
    csSurname: customer.lastName || 'Unknown',
    csOtherOrInitial: customer.middleName?.[0] || 'N',
    csDateOfBirth: toAmlDate(dob),
    csCountryOfCitizenship: citizenship,
    csCountryOfBirth: citizenship,
    csCountryOfDualNationality: citizenship,
    csCountry: countryCode,
    csNIdentifier: resolveIdentifierType(kyc, countryCode),
    csIdentifierNumber: String(identifier).replace(/-/g, ''),
    csIdentifierOtherDescription: 'N/A',
    csSinNumber: ssn,
    csEmail: customer.email || `${clientNumber}@placeholder.local`,
    csHomeTelephoneNumber: phone,
    csBusinessTelephoneNumber: phone,
    csTelephoneExtensionNumber: '0',
    csStreetAddress: streetAddress,
    csResidentialAddress: streetAddress,
    csResidentialCountry: countryCode,
    csCity: city,
    csProvinceOrState: region,
    csPostalOrZipCode: postalCode,
    csMailingAddress: streetAddress,
    csMailingCity: city,
    csMailingState: region,
    csMailingPoBox: postalCode,
    csClientLocation: resolveClientLocation(countryCode),
    csIssueDate: issue,
    csExpiryDate: expiry,
    csJurisdictionIssueCountry: citizenship,
    csJurisdictionIssueState: region,
    csOccupation: resolveOccupationCode(profession),
    csProfession: resolveProfessionId(profession, customer.sourceOfFund),
    csIndustryType: AML_DEFAULTS.industryType,
    csBusinessPurpose: AML_DEFAULTS.businessPurpose,
    csBusinessPurposeOther: 'International remittance',
    csSourceOfFund: resolveSourceOfFund(customer.sourceOfFund || kyc.source_of_fund),
    csTypesOfServices: AML_DEFAULTS.typesOfServices,
    csDeliveryChannel: AML_DEFAULTS.deliveryChannel,
    csNClientStatus: AML_DEFAULTS.clientStatus,
    csNatureOfBusinessRelationship: 'Remittance and money transfer',
    csEmployerLegalName: employerName,
    csEmployerAddress: streetAddress,
    csEmployerCity: city,
    csEmployerProvinceOrState: region,
    csEmployerPostalOrZipCode: postalCode,
    csEmployerCountry: countryCode,
    csEmployerBusinessTelephoneNumber: phone,
    csEmployerTelephoneExtensionNumber: '0',
    csPep: '2',
    csIsThirdparty: '2',
    csIsJointAccount: '2',
    csAreYouDoingThirdPartyTr: '2',
    csThirdpartyDeclaration: 'N/A',
    csIPAddress: '0.0.0.0',
  };

  return {
    nCUSTOMER_TYPE: 1,
    obj_CS_N,
  };
}
