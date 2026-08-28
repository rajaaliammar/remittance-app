# LiveEx APIs — Actually Used in Our System

**Scope:** Only APIs that are **implemented and called** by the mobile app (`remitance-app-new`) and by backend flows that serve that app.  
**Not included:** Portal-only APIs, unused lookups, or functions only defined but never invoked by the app.

**Verified against:** `remitance-app-new/src` + `Remittance_backend/src`  
**Date:** 26 August 2026

---

## Important correction

The previous document listed **all** LiveEx methods defined in backend services.  
Many of those exist for the **admin portal** or are **wired but unused by the app**.

This document lists **only what the mobile app path actually triggers**.

---

## Mobile app → our backend → LiveEx

### App screens / services

| App screen / file | Our API called | Hits LiveEx remote? |
|-------------------|----------------|---------------------|
| `CompleteProfile.tsx` | `POST /accounts/liveex/otp/send/` | Yes |
| `CompleteProfile.tsx` | `POST /accounts/liveex/otp/verify/` | Yes |
| `CompleteProfile.tsx` | `POST /accounts/liveex/attach/` | **No** (saves `rowIdGid` locally only) |
| `Verifying.tsx` | `GET /accounts/liveex/status/` | **No** (local config check only) |
| `Verifying.tsx` | `POST /accounts/liveex/run-registration/` | Yes (multi-step) |
| `Verifying.tsx` | `POST /accounts/aml/onboard/` | Yes (TMS) |
| `Verifying.tsx` | `POST /accounts/aml/documents/upload/` | Yes (TMS) |

App URL definitions: `remitance-app-new/src/services/urls.ts`  
App LiveEx client: `remitance-app-new/src/services/liveexOnboarding.ts`  
App AML client: `remitance-app-new/src/services/aml.ts`

---

## A. Digital Onboarding (used by app)

**Base:** `LIVEEX_ONBOARD_BASE_URL` → `https://amlhlep.com/TMSDigitalOnboardingWeb`  
**Service:** `Remittance_backend/src/services/liveexDigitalOnboarding.service.js`

| # | LiveEx API | Method | Defined at | When it runs in our system |
|---|------------|--------|------------|----------------------------|
| 1 | `/api/auth/login` | POST | L196 | Auto before every authenticated LiveEx call |
| 2 | `/api/otp/send` | POST | L278 | App email OTP (`CompleteProfile` → `liveexOnboardSendOtp` L71) |
| 3 | `/api/otp/verify` | POST | L293 | App OTP verify (`CompleteProfile` → controller L101) |
| 4 | `/api/customer/save-website` | POST | L304 | Inside `run-registration` (controller L258) |
| 5 | `/api/customer/temp-document` | POST | L315 | Inside `run-registration` — ID front L499, optional back L513, selfie L527 |
| 6 | `/api/customer/submit-kyc` | POST | L425 | Inside `run-registration` (controller L354) |
| 7 | `/api/customer/details` | POST | L326 | After submit inside `run-registration` (controller L389) |

### App registration chain (Verifying)

`POST /api/accounts/liveex/run-registration` triggers LiveEx in this order:

1. login  
2. save-website  
3. temp-document (front → back if needed → selfie)  
4. submit-kyc  
5. details  

---

## B. TMS / AML (used by app + send-money backend)

**Base:** `AML_BASE_URL` → `https://amlhlep.com/TMSSwaggerAPI`  
**Service:** `Remittance_backend/src/services/amlProvider.service.js`

| # | LiveEx TMS API | Method | Defined at | Used by |
|--|----------------|--------|------------|---------|
| 1 | `/api/Auth/login` | POST | L208 | Auto token for all TMS calls |
| 2 | `/api/Customers/save` | POST | L417 | App `POST /accounts/aml/onboard` → `aml.controller` L88 |
| 3 | `/api/Customers/documents` | POST | L421 | App `POST /accounts/aml/documents/upload` → L136 |
| 4 | `/api/Customers/documents?...` | GET | L430 | After upload (backend lists docs) → L146 |
| 5 | `/api/Customers/status/:id` | GET | L404 | Pre-send AML gate (`amlCustomerGate.js` L113); auto-approve (`amlAutoApprove.js` L184); remittance sync prep (`amlTransaction.service.js` L26) |
| 6 | `/api/Transactions/save` | POST | L614 | After remittance create (`amlTransaction.service.js` L87 → `postTransactionJobs.service.js`) |

---

## Explicitly NOT used by the mobile app

These exist in backend (and some in portal) but **the app does not call them**:

| LiveEx / feature | Why excluded |
|------------------|--------------|
| `/api/lookups/*` (countries, purposes, job-titles, industries, source-of-fund) | Backend route exists; app never calls `/accounts/liveex/lookups/:type` |
| Standalone `/accounts/liveex/details` | App does not call it (details only runs inside run-registration) |
| `/accounts/aml-sync` | Defined in app `aml.ts` / urls; **never called** from pages (dead path) |
| Portal AML listing / case-clear / validate / update-name / transaction listing | Portal only (`Remittence-portal`) |
| Utilities (`validate-ip`, `active-rules`, occupation, etc.) | Portal AML system utilities only |

---

## Summary — LiveEx remotes the app actually depends on

**Digital Onboarding (7):**  
login · otp/send · otp/verify · save-website · temp-document · submit-kyc · details  

**TMS AML (6):**  
login · Customers/save · Customers/documents (POST) · Customers/documents (GET) · Customers/status · Transactions/save  

**Total remote LiveEx APIs in the mobile-app path: 13** (plus local-only status + attach).

---

*Corrected document — only implemented calls for mobile app + related backend automation.*
