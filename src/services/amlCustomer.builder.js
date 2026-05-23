import { toAmlDate, resolveAmlClientNumber } from './amlProvider.service.js';

/**
 * Build AML Natural Person save payload from Remittance Customer record.
 */
export function buildNaturalCustomerSavePayload(customer) {
  const clientNumber = resolveAmlClientNumber(customer);
  const dob = customer.dateOfBirth
    ? new Date(customer.dateOfBirth)
    : new Date('1990-01-01');
  const today = toAmlDate(new Date());
  const expiry = toAmlDate(
    new Date(dob.getFullYear() + 10, dob.getMonth(), dob.getDate()),
  );

  const kyc =
    customer.kycData && typeof customer.kycData === 'object'
      ? customer.kycData
      : {};

  const nationality =
    customer.nationality ||
    customer.country ||
    kyc.citizenship ||
    'US';

  const identifier =
    kyc.ssn ||
    kyc.cnic ||
    kyc.passportNumber ||
    kyc.documentNumber ||
    clientNumber;

  return {
    nCUSTOMER_TYPE: 1,
    obj_CS_N: {
      csClientNumber: clientNumber,
      csGivenName: customer.firstName || 'Unknown',
      csSurname: customer.lastName || 'Unknown',
      csDateOfBirth: toAmlDate(dob),
      csCountryOfCitizenship: nationality,
      csCountryOfBirth: nationality,
      csNIdentifier: 1,
      csIdentifierNumber: String(identifier).replace(/-/g, ''),
      csEmail: customer.email || `${clientNumber}@placeholder.local`,
      csHomeTelephoneNumber:
        customer.phone || customer.telephone || '0000000000',
      csCountry: customer.country || nationality,
      csCity: customer.city || 'N/A',
      csClientLocation: customer.address || 'N/A',
      csIssueDate: today,
      csExpiryDate: expiry,
      csJurisdictionIssueCountry: nationality,
      csOccupation: customer.occupation || 'Other',
      csProfession: customer.occupation || 'Other',
      csIndustryType: 'Financial Services',
      csBusinessPurpose: 'Remittance',
      csSourceOfFund: customer.sourceOfFund || 'Salary',
      csTypesOfServices: 'Remittance',
    },
  };
}
