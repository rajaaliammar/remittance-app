/** Shared helpers for portal/app KYC approval checks. */

export function parseCustomerKycDocuments(kycData) {
  if (kycData == null) return [];
  let raw = kycData;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return [raw];
  return [];
}

export function customerHasApprovedKyc(kycData) {
  return parseCustomerKycDocuments(kycData).some(
    (doc) => String(doc?.status || '').toLowerCase() === 'approved',
  );
}
