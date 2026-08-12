import { toAmlDate, resolveAmlClientNumber } from './amlProvider.service.js';
import { pickKycFieldFromCustomer } from '../utils/amlKycData.js';
import {
  AML_DEFAULTS,
  normalizeCountryCode,
  resolveClientLocation,
  resolveIdentifierType,
  resolveOccupationCode,
  resolveProfessionId,
  resolveSourceOfFund,
  resolveJurisdictionIssueCountry,
  resolveJurisdictionIssueState,
  formatAmlPhone,
} from './amlFieldCodes.js';

/**
 * Build AML Natural Person save payload from Remittance Customer record.
 * LiveEx TMS expects integer lookup codes for coded fields (not free text).
 */
export function buildNaturalCustomerSavePayload(customer) {
  const clientNumber = resolveAmlClientNumber(customer);
  // Pass DOB string through toAmlDate — do not use new Date("YYYY-MM-DD") (UTC shift)
  const dobAml = customer.dateOfBirth
    ? toAmlDate(customer.dateOfBirth)
    : toAmlDate('1990-01-01');
  const todayDate = new Date();
  const issueDate = new Date(todayDate);
  issueDate.setFullYear(issueDate.getFullYear() - 1);
  const today = toAmlDate(todayDate);
  const issue = toAmlDate(issueDate);
  const expiry = toAmlDate(
    new Date(todayDate.getFullYear() + 10, todayDate.getMonth(), todayDate.getDate()),
  );

  const idTypeHint =
    pickKycFieldFromCustomer(
      customer,
      'id_type',
      'idType',
      'document_type',
      'docTypeName',
    ) || '';
  const docTypeNameHint =
    pickKycFieldFromCustomer(customer, 'docTypeName', 'document_type_name') ||
    idTypeHint;

  // Residential country: address country first. Ignore residentCountry when it is
  // a status word like "Resident" (registration historically mis-stored that).
  const countryCode = normalizeCountryCode(
    customer.country ||
      pickKycFieldFromCustomer(customer, 'country', 'liveex_country_id', 'country_id') ||
      customer.residentCountry ||
      'US',
    'US',
  );

  const citizenship = normalizeCountryCode(
    customer.nationality ||
      pickKycFieldFromCustomer(customer, 'citizenship', 'nationality', 'liveex_nationality_id') ||
      countryCode,
    countryCode,
  );

  const issueCountry = resolveJurisdictionIssueCountry({
    idType: idTypeHint,
    docTypeName: docTypeNameHint,
    residentialCountry: countryCode,
    citizenship,
    explicitIssueCountry:
      pickKycFieldFromCustomer(
        customer,
        'jurisdiction_country',
        'issue_country',
        'id_issue_country',
      ) || null,
  });

  const region =
    customer.region || pickKycFieldFromCustomer(customer, 'region', 'state') || '';
  const jurisdictionState = resolveJurisdictionIssueState(issueCountry, region);

  const identifier =
    pickKycFieldFromCustomer(
      customer,
      'ssn',
      'government_id',
      'cnic',
      'passportNumber',
      'passport',
      'documentNumber',
      'id_number',
      'identifier_number',
    ) || clientNumber;

  const streetAddress =
    customer.address ||
    pickKycFieldFromCustomer(customer, 'address', 'street_address') ||
    'Not Provided';
  const postalCode =
    customer.zipCode ||
    pickKycFieldFromCustomer(customer, 'zipCode', 'zip_code') ||
    '00000';
  const city = customer.city || pickKycFieldFromCustomer(customer, 'city') || 'Unknown';
  const profession =
    customer.occupation ||
    pickKycFieldFromCustomer(customer, 'occupation', 'profession') ||
    'Other';
  const phoneRaw = customer.phone || customer.telephone || '0000000000';
  // AML TMS requires CountryCode-Number (e.g. 1-4654564564). Digital Onboarding uses
  // mobileNumberCode + national phone separately — do not mix those formats here.
  const phone = formatAmlPhone(phoneRaw, countryCode);
  const ssn =
    pickKycFieldFromCustomer(customer, 'ssn') ||
    (countryCode === 'US' ? String(identifier).replace(/-/g, '') : 'N/A');
  const employerName =
    pickKycFieldFromCustomer(customer, 'employer') || profession || 'Self Employed';

  const obj_CS_N = {
    csClientNumber: clientNumber,
    csGivenName: customer.firstName || 'Unknown',
    csSurname: customer.lastName || 'Unknown',
    csOtherOrInitial: customer.middleName?.[0] || 'N',
    csDateOfBirth: dobAml,
    csCountryOfCitizenship: citizenship,
    csCountryOfBirth: citizenship,
    csCountryOfDualNationality: citizenship,
    csCountry: countryCode,
    csNIdentifier: resolveIdentifierType(
      {
        id_type: idTypeHint,
        docTypeName: docTypeNameHint,
        ssn: pickKycFieldFromCustomer(customer, 'ssn'),
        government_id: pickKycFieldFromCustomer(customer, 'government_id'),
        passportNumber: pickKycFieldFromCustomer(customer, 'passportNumber', 'passport'),
        cnic: pickKycFieldFromCustomer(customer, 'cnic'),
      },
      countryCode,
      issueCountry,
    ),
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
    csProvinceOrState: region || 'NA',
    csPostalOrZipCode: postalCode,
    csMailingAddress: streetAddress,
    csMailingCity: city,
    csMailingState: region || 'NA',
    csMailingPoBox: postalCode,
    csClientLocation: resolveClientLocation(countryCode),
    csIssueDate: issue,
    csExpiryDate: expiry,
    // AML expects ISO country code (US/CA/…), NOT Digital Onboarding lookup ids (251/307)
    csJurisdictionIssueCountry: issueCountry,
    csJurisdictionIssueState: jurisdictionState || region || 'NA',
    csOccupation: resolveOccupationCode(profession),
    csProfession: resolveProfessionId(
      profession,
      customer.sourceOfFund ||
        pickKycFieldFromCustomer(customer, 'source_of_fund', 'sourceOfFund'),
    ),
    csIndustryType: AML_DEFAULTS.industryType,
    csBusinessPurpose: AML_DEFAULTS.businessPurpose,
    csBusinessPurposeOther: 'International remittance',
    csSourceOfFund: resolveSourceOfFund(
      customer.sourceOfFund ||
        pickKycFieldFromCustomer(customer, 'source_of_fund', 'sourceOfFund'),
    ),
    csTypesOfServices: AML_DEFAULTS.typesOfServices,
    csDeliveryChannel: AML_DEFAULTS.deliveryChannel,
    csNClientStatus: AML_DEFAULTS.clientStatus,
    csNatureOfBusinessRelationship: 'Remittance and money transfer',
    csEmployerLegalName: employerName,
    csEmployerAddress: streetAddress,
    csEmployerCity: city,
    csEmployerProvinceOrState: region || 'NA',
    csEmployerPostalOrZipCode: postalCode,
    csEmployerCountry: countryCode,
    csEmployerBusinessTelephoneNumber: phone,
    csEmployerTelephoneExtensionNumber: '0',
    csPep: '2',
    csIsThirdparty: '2',
    csIsJointAccount: '2',
    csAreYouDoingThirdPartyTr: '2',
    csThirdpartyDeclaration: 'N/A',
    csIPAddress: customer.lastIpAddress || '0.0.0.0',
  };

  return {
    nCUSTOMER_TYPE: 1,
    obj_CS_N,
  };
}
