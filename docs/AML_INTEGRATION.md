# AML Integration (Remittance_backend only)

All AML/KYC calls run through **Remittance_backend** → LiveEx TMS API.  
The admin portal (`Remittence-portal`) never calls AML directly.

## Environment (`.env`)

```env
AML_BASE_URL=https://amlhlep.com/UET_TMSSwaggerAPI
AML_CODE=9001
AML_USERNAME=admin_Demo
AML_PASSWORD=your_password
AML_REQUEST_TIMEOUT_MS=30000
AML_TOKEN_TTL_SECONDS=3300
AML_LOG=true
```

### Verify credentials (run from project root)

```bash
curl -sS -X POST "$AML_BASE_URL/api/Auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"Code":9001,"User_Name":"admin_Demo","Password":"YOUR_PASSWORD"}'
```

Expected: JSON with `"token":"eyJ..."`.  
If you see `"Invalid Credentials"` and HTTP 401, fix `.env` before using the portal AML buttons.

**Important:** If your password contains `#`, wrap it in double quotes in `.env`, e.g. `AML_PASSWORD="123@45678#"`. Without quotes, everything after `#` is treated as a comment and the password is truncated.

## Console output

On server start you will see:

```
[AML] LiveEx TMS integration (Remittance_backend)
[AML] Base URL: ...
[AML] Status: CONFIGURED — ready
```

Each API call logs e.g.:

```
[AML] POST /api/Auth/login — authenticating…
[AML] Login success — token cached (eyJhbGciOiJIUzI1…, TTL 3300s)
[AML] GET /api/Customers/status/CS_abc123 — OK → Onboarded (statusId: 6)
```

## Portal API routes

| Method | Route | Action |
|--------|-------|--------|
| GET | `/api/customers/:id/aml/cached` | Last saved AML snapshot |
| GET | `/api/customers/:id/aml/status` | Live status from provider |
| POST | `/api/customers/:id/aml/validate` | Run validation + sanctions/RBA |
| POST | `/api/customers/:id/aml/onboard` | `POST /api/Customers/save` |
| POST | `/api/customers/:id/aml/case-clear` | Clear compliance case (body: `{ "remarks": "..." }`) |
| GET | `/api/customers/:id/aml/documents` | List AML documents (proxies `GET /api/Customers/documents?ClientNumber=…`) |
| GET | `/api/customers/:id/aml/documents/preview` | Count KYC files available to upload |
| POST | `/api/customers/:id/aml/documents/upload` | Upload KYC files from `/uploads/kyc` to AML (`POST /api/Customers/documents`) |

Portal (`AmlComplianceCard`): **Submit to AML** → **Submit docs to AML** → **View AML documents**; **Clear AML case** when needed.

### Why AML documents list is empty

AML TMS does not receive app uploads automatically. After the customer completes KYC in the mobile app, an admin must:

1. **Submit to AML** (creates the AML customer record)
2. **Submit docs to AML** (reads ID/selfie/POA from `Customer.kycData` + files on disk, base64 upload to LiveEx)
3. **View AML documents** to confirm

AML client number defaults to `CS_{customerId}` (stored in `kycData.amlClientNumber` after first sync).

## Recommended flow

1. Customer registers in app → saved in PostgreSQL  
2. Admin opens customer in portal → **Submit to AML** (`/aml/onboard`)  
3. **Run AML validation** → review sanctions/RBA in modal  
4. **Refresh status** until `Onboarded` (statusId 6)  
5. If case: **case-clear** with remarks from compliance officer  
