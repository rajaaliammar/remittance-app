/**
 * Customer.kycData is often an array (mobile registration). AML cache lives on
 * the entry that has `aml` / `amlClientNumber`, not at the root object.
 */

function pickField(entry, ...keys) {
  for (const key of keys) {
    const val = entry?.[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return null;
}

function flattenKycEntries(kycData) {
  if (!kycData) return [];
  if (Array.isArray(kycData)) return kycData.filter((e) => e && typeof e === 'object');
  if (typeof kycData === 'object') return [kycData];
  return [];
}

/** Find the KYC entry that holds AML sync data (usually last Enhanced KYC row). */
export function findAmlKycEntry(kycData) {
  const entries = flattenKycEntries(kycData);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].aml && typeof entries[i].aml === 'object') return entries[i];
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].amlClientNumber) return entries[i];
  }
  return null;
}

/** Normalized AML cache for portal + GET /aml/cached */
export function extractAmlCacheFromKycData(kycData) {
  const entry = findAmlKycEntry(kycData);
  if (!entry?.aml || typeof entry.aml !== 'object') return null;

  const aml = entry.aml;
  const mapped =
    aml.mapped && typeof aml.mapped === 'object'
      ? aml.mapped
      : {
          statusId: aml.statusId ?? null,
          statusLabel: aml.statusLabel ?? null,
          pin: aml.pin ?? null,
          clientNumber: aml.clientNumber ?? entry.amlClientNumber ?? null,
          isOnboarded: aml.isOnboarded ?? null,
          isBlocked: aml.isBlocked ?? null,
          isFrozen: aml.isFrozen ?? null,
          riskScore: aml.riskScore ?? null,
          rowIdGid: aml.rowIdGid ?? null,
          sanctionDetails: aml.sanctionDetails ?? null,
          rbaDetails: aml.rbaDetails ?? null,
          smartRules: aml.smartRules ?? null,
          message: aml.message ?? null,
          isError: aml.isError ?? null,
          messageCode: aml.messageCode ?? null,
          messageDetails: aml.messageDetails ?? null,
        };

  return {
    clientNumber: entry.amlClientNumber || aml.clientNumber || mapped.clientNumber || null,
    mapped,
    syncedAt: aml.syncedAt || aml.lastDocumentsUploadAt || null,
    lastSaveResponse: aml.lastSaveResponse ?? null,
    lastStatusResponse: aml.lastStatusResponse ?? null,
    lastValidateResponse: aml.lastValidateResponse ?? null,
    lastDocumentsUploadResponse: aml.lastDocumentsUploadResponse ?? null,
    lastDocumentsUploadAt: aml.lastDocumentsUploadAt ?? null,
  };
}

/** Pick a field from KYC array entries (enhancedKYC documents[] or top-level keys). */
export function pickKycFieldFromCustomer(customer, ...keys) {
  for (const entry of flattenKycEntries(customer?.kycData)) {
    const direct = pickField(entry, ...keys);
    if (direct) return direct;

    const fields = entry.documents || entry.fields;
    if (!Array.isArray(fields)) continue;

    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      const name = String(field.fieldName || field.name || '').toLowerCase();
      for (const key of keys) {
        if (name.includes(String(key).toLowerCase())) {
          const val = field.value ?? field.fileUrl;
          if (val != null && String(val).trim()) return String(val).trim();
        }
      }
    }
  }

  return null;
}
