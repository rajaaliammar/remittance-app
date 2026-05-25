/** Default strings for optional AML transaction / beneficiary fields. */
export const AML_NA = 'N/A';
export const AML_NO = '2';

/**
 * LiveEx ASP.NET model binds Obj_TR with TR_* property names (not tR_*).
 */
export function buildDefaultObjTR(overrides = {}) {
  const na = AML_NA;
  const base = {
    TR_IS_PROPERTY: 'N',
    TR_PROPERTY_NUMBER: na,
    TR_TR_IDENTIFIER_1: na,
    TR_TR_IDENTIFIER_2: na,
    TR_TR_IDENTIFIER_3: na,
    TR_SENDER_ADDRESS_1: na,
    TR_SENDER_ADDRESS_2: na,
    TR_SENDER_ADDRESS_3: na,
    TR_RECIEVER_ADDRESS_1: na,
    TR_RECIEVER_ADDRESS_2: na,
    TR_RECIEVER_ADDRESS_3: na,
    TR_PROPERTY_IDENTIFIER: na,
    TR_CONDUCTED_MODE_OTHER: na,
    TR_DETAIL_OF_FUND_OTHER: na,
    TR_PROPERTY_DESCRIPTION: na,
    TR_PROPERTY_POLICY_ISSUER: na,
    TR_PROPERTY_POLICY_NUMBER: na,
    TR_PROPERTY_NAME_OF_ISSUER: na,
    TR_METHOD_OTHER_DESCRIPTION: na,
    TR_PROPERTY_REAL_ESTATE_TYPE: na,
    TR_PROPERTY_TYPE_OF_CURRENCY: na,
    TR_TYPE_OF_DEVICE_USED_OTHER: na,
    TR_PROPERTY_IDENTIFIER_NUMBER: na,
    TR_PROPERTY_SECURITIES_NUMBER: na,
    TR_HOW_VIRTUAL_CURRENCY_OBTAINED: na,
    TR_OTHER_NO_RELATED_REFERENCE_NO: na,
    TR_PROPERTY_ADDITIONAL_INFO_POLICY: na,
    TR_PROPERTY_TYPE_OTHER_DESCRIPTION: na,
    TR_PROPERTY_TRAVELLERS_CHECK_NUMBER: na,
    TR_DISPOSITION_OF_FUND_POLICY_NUMBER: na,
    TR_PROPERTY_NAME_OF_ISSUER_SECURITIES: na,
    TR_PROPERTY_ADDITIONAL_INFO_ABOUT_CASH: na,
    TR_PROPERTY_ADDITIONAL_INFO_SECURITIES: na,
    TR_PROPERTY_ADDITIONAL_INFO_MONEY_ORDER: na,
    TR_PROPERTY_ADDITIONAL_INFO_REAL_ESTATE: na,
    TR_DISPOSITION_OF_FUND_OTHER_DISCRIPTION: na,
    TR_PROPERTY_ADDITIONAL_INFO_ABOUT_ACCOUNT: na,
    TR_PROPERTY_NAME_OF_FINANCIAL_INSTITUTION: na,
    TR_PROPERTY_NAME_OF_ISSUER_TRAVELLERS_CHECK: na,
    TR_PROPERTY_ADDITIONAL_INFO_TRAVELLERS_CHECK: na,
    TR_IS_VIRTUAL_CURRENCY: false,
    TR_VIRTUAL_LC: 0,
    TR_COMMISSION: 0,
    TR_FEE: 0,
    TR_IsUPDATE: false,
    onlineMatchedRules: na,
  };
  return { ...base, ...overrides };
}

export function buildDefaultObjBNI(overrides = {}) {
  const na = AML_NA;
  const today = overrides._today || '';
  const base = {
    bni_Pep: AML_NO,
    bni_City: overrides.bni_City || na,
    bni_Email: overrides.bni_Email || 'beneficiary@placeholder.local',
    bni_IssueDate: overrides.bni_IssueDate || today,
    bni_ExpiryDate: overrides.bni_ExpiryDate || today,
    bni_Percentage: '100',
    bni_EmployerCity: na,
    bni_PlaceOfBirth: overrides.bni_PlaceOfBirth || na,
    bni_StreetAddress: overrides.bni_StreetAddress || na,
    bni_DualNationality: overrides.bni_DualNationality || na,
    bni_EmployerAddress: na,
    bni_EmployerCountry: overrides.bni_EmployerCountry || na,
    bni_PostalOrZipCode: overrides.bni_PostalOrZipCode || '00000',
    bni_ProvinceOrState: overrides.bni_ProvinceOrState || na,
    bni_EmployerLegalName: na,
    bni_JurisdictionIssueState: na,
    bni_BusinessTelephoneNumber: overrides.bni_HomeTelephoneNumber || na,
    bni_EmployerPostalOrZipCode: na,
    bni_EmployerProvinceOrState: na,
    bni_JurisdictionIssueCountry: overrides.bni_CountryOfCitizenship || na,
    bni_TelephoneExtensionNumber: '0',
    bni_IdentifierOtherDescription: na,
    bni_ExpectedIncomeRangeAnnually: na,
    bni_RelationshipOtherDescription: na,
    bni_EmployerBusinessTelephoneNumber: na,
    bni_EmployerTelephoneExtensionNumber: '0',
    bni_Occupation: 454,
    bni_SourceOfWealth: 1,
    bni_SourceOfFund: 1,
    bni_Relationship: 8,
  };
  delete base._today;
  return { ...base, ...overrides };
}
