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
   - `save-website`
   - `temp-document` (front → back → selfie with `livenessPath`)
   - `submit-kyc`
5. Soft TMS onboard + docs for remittance gate
6. Portal **AML / Face & ID** tab shows decision, match %, OCR ID #

## Env

```env
LIVEEX_DIGITAL_ONBOARDING_ENABLED=true
LIVEEX_ONBOARD_BASE_URL=https://amlhlep.com/TMSDigitalOnboardingWeb
# Defaults to AML_CODE / AML_USERNAME / AML_PASSWORD if unset
LIVEEX_ONBOARD_COMPANY_CODE=
LIVEEX_ONBOARD_USERNAME=
LIVEEX_ONBOARD_PASSWORD=
```

Use **Shield** partner credentials from LiveEx (TMS login may not work on Shield).

## Key routes

**Mobile**
- `GET /api/accounts/liveex/status`
- `POST /api/accounts/liveex/otp/send|verify`
- `POST /api/accounts/liveex/attach`
- `POST /api/accounts/liveex/run-registration`

**Portal**
- `GET /api/customers/:id/liveex/cached`
- `POST /api/customers/:id/liveex/details`
- `POST /api/customers/:id/liveex/run`
