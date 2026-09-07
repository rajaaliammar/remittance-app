# LiveEx Digital Onboarding — Face & ID Verification

Implements LiveExShield CIP across **backend**, **mobile app**, and **portal**.

## Products (do not confuse)

| Product | Env | Purpose |
|---------|-----|---------|
| **Digital Onboarding** (this doc) | `LIVEEX_ONBOARD_*` → `amlhlep.com/TMSDigitalOnboardingWeb` | Email OTP, ID OCR, selfie liveness/face match, screening |
| **TMS AML** | `AML_*` → `amlhlep.com` | Customer sync + remittance transaction AML |

## Registration flow

1. App email → LiveEx email OTP → `rowIdGid`
2. Phone OTP, profile, KYC ID front/back, selfie (stored locally)
3. Attach `rowIdGid` to customer
4. `/verifying` → `POST /api/accounts/liveex/run-registration`:
   - `save-website` (includes `sendUrl` for re-request emails)
   - `temp-document` (front → back → selfie with `livenessPath` = front `savedFilePath`)
   - `submit-kyc` with **legacy binder keys**: `roW_ID_GID`, `full_Name`, `iD_TYPE`, `namE_Front`, `namE_Back`, `namE_Selfie`
5. Soft TMS onboard + docs for remittance gate
6. Portal **AML / Face & ID** tab shows decision, match %, OCR ID #

### Identity doc types (LiveEx)

| `docTypeId` / `iD_TYPE` | Name |
|-------------------------|------|
| 4 | Citizenship Card |
| 5 | Passport |
| 7 | Drivers Licence |

Do **not** send `1`. Selfie / ID front / ID back must use `/api/customer/temp-document` only — not `/api/customer/documents`.

### Country lookup ids (Digital Onboarding)

From `GET /api/lookups/countries` — do **not** invent ids:

| Country | id |
|---------|-----|
| United States | **251** |
| Canada | 307 |
| Cape Verde | 308 |
| Pakistan | 253 |
| Ethiopia | 346 |

A previous bug mapped United States → `308` (Cape Verde). Residential defaults must use **251**.

### save-website fields that were missing

Swagger `CustomerSaveWebRequest` requires these for the TMS form to fill:

| Field | Purpose |
|-------|---------|
| `jurisdictionOfIssueCountry` | LiveEx countries lookup id (same as nationality/residence) |
| `jurisdictionOfState` | Issue state/province (e.g. `CO`) |
| `mobileNumberCode` | ISO alpha-2 from countries lookup (`US`, `CA`, `MX`) — **not** dial code `1` |
| `phone` | National number only (`4654564564`) |
| `residentialCountry` | (not `residentCountry`) |

**AML `/api/Customers/save` is a different contract:** phone must be `CountryCode-Number` (e.g. `1-4654564564`), and `csJurisdictionIssueCountry` must be an ISO code (`US`), not a Digital Onboarding lookup id (`251`).

## Env

```env
LIVEEX_DIGITAL_ONBOARDING_ENABLED=true
LIVEEX_ONBOARD_BASE_URL=https://amlhlep.com/TMSDigitalOnboardingWeb
# Defaults to AML_CODE / AML_USERNAME / AML_PASSWORD if unset
LIVEEX_ONBOARD_COMPANY_CODE=
LIVEEX_ONBOARD_USERNAME=
LIVEEX_ONBOARD_PASSWORD=
# Base used to build save-website sendUrl (re-request email deep link)
# LIVEEX_SEND_URL_BASE=https://your-app.example.com
```

Use **Shield** partner credentials from LiveEx (TMS login may not work on Shield).

## Key routes

**Mobile**
- `GET /api/accounts/liveex/status`
- `POST /api/accounts/liveex/otp/send|verify`
- `POST /api/accounts/liveex/attach`
- `POST /api/accounts/liveex/run-registration` body may include `idType` (4|5|7) and `docTypeName`

**Portal**
- `GET /api/customers/:id/liveex/cached`
- `POST /api/customers/:id/liveex/details`
- `POST /api/customers/:id/liveex/run`
