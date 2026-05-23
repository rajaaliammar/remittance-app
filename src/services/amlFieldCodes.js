/**
 * LiveEx TMS lookup codes for Natural Person (obj_CS_N).
 * See swagger: 01_NaturalCustomerDto
 */

/** Map ISO country to AML csClientLocation (1=VCE region, 2=Canada outside VCE, 3=outside Canada) */
export function resolveClientLocation(countryCode) {
  const c = String(countryCode || 'US').toUpperCase();
  if (c === 'CA') return 2;
  return 3;
}

/** ID document type — csNIdentifier */
export function resolveIdentifierType(kyc, countryCode) {
  if (kyc?.ssn || kyc?.government_id) return 15; // SSN
  if (kyc?.passportNumber || kyc?.passport) return 5;
  if (kyc?.cnic) return 4;
  const c = String(countryCode || 'US').toUpperCase();
  return c === 'US' ? 15 : 5;
}

export function normalizeCountryCode(value) {
  if (!value) return 'US';
  const v = String(value).trim().toUpperCase();
  if (v.length === 2) return v;
  const map = {
    'UNITED STATES': 'US',
    USA: 'US',
    PAKISTAN: 'PK',
    'UNITED KINGDOM': 'GB',
    CANADA: 'CA',
  };
  return map[v] || v.slice(0, 2);
}

/** csSourceOfFund — default Salary */
export function resolveSourceOfFund(sourceText) {
  const s = String(sourceText || '').toLowerCase();
  if (s.includes('saving')) return 2;
  if (s.includes('business') || s.includes('freelance')) return 4;
  return 1; // Salary
}

/** csOccupation — provider occupation code (integer) */
export function resolveOccupationCode(occupationText) {
  const s = String(occupationText || '').toLowerCase();
  if (s.includes('engineer')) return 50;
  if (s.includes('teacher')) return 200;
  if (s.includes('student')) return 180;
  if (s.includes('retired')) return 150;
  return 1;
}

/** csProfession ID string: 875=Salaried, 876=Unemployed, 877=Self Employed */
export function resolveProfessionId(occupationText, sourceText) {
  const s = `${occupationText || ''} ${sourceText || ''}`.toLowerCase();
  if (s.includes('self') || s.includes('freelance') || s.includes('business')) return '877';
  if (s.includes('unemploy')) return '876';
  return '875';
}

/** AML phone: CountryCode-Number e.g. 1-5012345678 */
export function formatAmlPhone(phone, countryCode = 'US') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '1-0000000000';
  if (digits.includes('-')) return phone;
  const cc = countryCode === 'US' ? '1' : countryCode === 'PK' ? '92' : '1';
  if (digits.length === 10 && cc === '1') return `1-${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `1-${digits.slice(1)}`;
  if (digits.length > 10) {
    return `${digits.slice(0, digits.length - 10)}-${digits.slice(-10)}`;
  }
  return `${cc}-${digits}`;
}

export const AML_DEFAULTS = {
  businessPurpose: parseInt(process.env.AML_DEFAULT_BUSINESS_PURPOSE || '10', 10), // Cross-border
  industryType: parseInt(process.env.AML_DEFAULT_INDUSTRY_TYPE || '1030', 10),
  typesOfServices: process.env.AML_DEFAULT_TYPES_OF_SERVICES || '1', // Foreign Exchange
  deliveryChannel: parseInt(process.env.AML_DEFAULT_DELIVERY_CHANNEL || '2', 10), // Non face-to-face
  clientStatus: parseInt(process.env.AML_DEFAULT_CLIENT_STATUS || '10', 10), // Non-Resident
};
