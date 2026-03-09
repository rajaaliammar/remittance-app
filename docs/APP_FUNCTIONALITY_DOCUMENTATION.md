# Remittance App - Complete Functionality Documentation

## Table of Contents
1. [Overview](#overview)
2. [App Architecture](#app-architecture)
3. [User Registration & Onboarding Flow](#user-registration--onboarding-flow)
4. [Authentication & Login Flow](#authentication--login-flow)
5. [Remittance Transaction Flow](#remittance-transaction-flow)
6. [KYC Verification Flow](#kyc-verification-flow)
7. [Wallet & Balance Management](#wallet--balance-management)
8. [Transaction History & Activity](#transaction-history--activity)
9. [Settings & Profile Management](#settings--profile-management)
10. [Support & Communication](#support--communication)
11. [Data Flow Diagrams](#data-flow-diagrams)
12. [API Integration](#api-integration)
13. [Database Tables & Relationships](#database-tables--relationships)

---

## Overview

The Remittance App is a mobile application (React Native) that enables users to send money internationally. Users can register, complete KYC verification, add money to their wallet, and send remittances to recipients in various countries through different payment gateways.

**✅ Implementation Status**: This documentation describes the **CURRENT** implementation. All documented features are functional and in production.

### Key Features
- **User Registration**: Phone/Email based registration with OTP verification
- **KYC Verification**: Multi-step KYC process with document upload
- **Remittance Sending**: Send money to multiple countries via bank/wallet transfers
- **Transaction Management**: View history, track status, receive notifications
- **Wallet Management**: View balance, transaction limits, account details
- **Support**: In-app chat with admin, FAQs, help center

---

## App Architecture

### Technology Stack
- **Frontend**: React Native (mobile app)
- **Backend**: Express.js (Node.js)
- **Database**: PostgreSQL with Prisma ORM
- **Real-time**: Socket.io for notifications
- **Authentication**: JWT tokens
- **Push Notifications**: Firebase Cloud Messaging (FCM)

### App Structure

```
remitance-app/
├── components/          # Screen components
├── src/
│   ├── navigation/     # Navigation setup
│   ├── services/       # API services
│   ├── redux/          # State management
│   ├── utils/          # Utility functions
│   └── constants/     # App constants
└── App.tsx            # Main app entry
```

---

## User Registration & Onboarding Flow

### Complete Registration Process

```
1. SPLASH SCREEN
   ↓
2. ONBOARDING SCREEN (if first launch)
   ↓
3. AUTH SCREEN
   - Choose: Create Account or Login
   ↓
4. CREATE ACCOUNT SCREEN
   - Enter: Phone Number OR Email
   - Select Country Code (for phone)
   ↓
5. VERIFICATION METHOD SCREEN
   - Choose: OTP via SMS/Email
   ↓
6. OTP SCREEN
   - Enter OTP code
   - Verify OTP → POST /api/accounts/verify-otp
   ↓
7. PERSONAL DETAIL SCREEN
   - Enter: First Name, Last Name
   - (Optional: Middle Name)
   ↓
8. REGISTRATION PASSWORD SCREEN
   - Create password
   - Confirm password
   ↓
9. CREATE PIN SCREEN
   - Enter 4-digit PIN
   ↓
10. CONFIRM PIN SCREEN
    - Confirm 4-digit PIN
    ↓
11. COMPLETE PROFILE SCREEN (Optional)
    - Additional profile fields based on RegistrationSettings
    ↓
12. KYC INTRO SCREEN
    - Information about KYC requirements
    ↓
13. KYC REGISTRATION DETAILS SCREEN
    - Enter KYC form fields
    ↓
14. KYC DOCUMENT SCREEN
    - Upload ID documents
    ↓
15. HOME SCREEN (Registration Complete)
```

### Registration API Flow

#### Step 1: Request OTP
**Endpoint**: `POST /api/accounts/send-otp`

**Request**:
```json
{
  "country_code": "251",
  "phone_number": "912345678",
  "email": "user@example.com"  // OR email instead of phone
}
```

**Response**:
```json
{
  "success": true,
  "message": "OTP sent successfully"
}
```

**Backend Process**:
1. Validate phone/email format
2. Check if user already exists
3. Generate OTP code
4. Send OTP via SMS (Twilio) or Email
5. Store OTP in session/cache (with expiration)

#### Step 2: Verify OTP
**Endpoint**: `POST /api/accounts/verify-otp`

**Request**:
```json
{
  "country_code": "251",
  "phone_number": "912345678",
  "otp": "123456"
}
```

**Response**:
```json
{
  "success": true,
  "access_token": "jwt_token_here",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "phone": "912345678",
    "first_name": "John",
    "last_name": "Doe",
    "has_pin": false,
    "status": "pending"
  }
}
```

**Backend Process**:
1. Verify OTP code
2. Create Customer record in `customers` table
3. Set initial status: `pending`
4. Generate JWT access token
5. Return user data and token

**Database Changes**:
- `INSERT INTO customers` (email, phone, password hashed, status: 'pending')
- `availableBalance`: NULL (0.00)
- `kycData`: NULL (not yet submitted)

#### Step 3: Complete Profile
**Endpoint**: `PUT /api/customers/:id` or `POST /api/customers/complete-profile`

**Request**:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "middleName": "Michael",
  "dateOfBirth": "1990-01-01",
  "gender": "Male",
  "nationality": "US",
  "address": "123 Main St",
  "city": "New York",
  "country": "US",
  "zipCode": "10001"
}
```

**Database Changes**:
- `UPDATE customers` with profile fields
- Fields depend on `RegistrationSettings` table configuration

#### Step 4: Create PIN
**Endpoint**: `POST /api/customers/set-pin` or `PUT /api/customers/:id`

**Request**:
```json
{
  "pin": "1234"  // 4-digit PIN (hashed on backend)
}
```

**Database Changes**:
- `UPDATE customers SET pin = hashed_pin, hasPin = true`

---

## Authentication & Login Flow

### Login Methods

1. **Password Login**
2. **PIN Login** (4-digit PIN)
3. **Biometric Login** (Face ID / Fingerprint)

### Password Login Flow

```
1. LOGIN SCREEN
   - Choose: Email or Phone login
   - Enter credentials
   ↓
2. LOGIN PASSWORD SCREEN
   - Enter password
   - Submit → POST /api/auth/login
   ↓
3. IF PIN SET:
   - Navigate to CONFIRM LOGIN PIN SCREEN
   - Enter PIN for additional security
   ↓
4. HOME SCREEN
```

### PIN Login Flow

```
1. LOGIN PIN SCREEN
   - Enter 4-digit PIN
   - Submit → POST /api/auth/login-pin
   ↓
2. HOME SCREEN
```

### Login API Endpoints

#### Password Login
**Endpoint**: `POST /api/auth/login`

**Request**:
```json
{
  "email": "user@example.com",
  "password": "user_password"
}
// OR
{
  "country_code": "251",
  "phone_number": "912345678",
  "password": "user_password"
}
```

**Response**:
```json
{
  "success": true,
  "access_token": "jwt_token",
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "has_pin": true,
    "status": "approved"
  }
}
```

**Backend Process**:
1. Find customer by email/phone
2. Verify password (bcrypt)
3. Check customer status (must be approved for transactions)
4. Generate JWT token
5. Update `lastSeenAt` timestamp
6. Return token and user data

#### PIN Login
**Endpoint**: `POST /api/auth/login-pin`

**Request**:
```json
{
  "country_code": "251",
  "phone_number": "912345678",
  "pin": "1234"
}
```

**Response**: Same as password login

**Backend Process**:
1. Find customer by phone
2. Verify PIN (hashed comparison)
3. Check PIN attempt limits (lock after 5 failed attempts)
4. Generate JWT token
5. Return token and user data

### Authentication Middleware

**Location**: `src/middleware/auth.js`

**Process**:
1. Extract token from `Authorization` header
2. Verify JWT token
3. Find customer by token payload
4. Attach user to `req.user`
5. Continue to route handler

---

## Remittance Transaction Flow

### Complete Send Money Flow

```
1. HOME SCREEN
   - Tap "Send Money" or "Remittance"
   ↓
2. REMITTANCE SCREEN
   - Overview of remittance features
   ↓
3. REMITTANCE COUNTRY SELECTION SCREEN
   - Select destination country
   - Shows popular countries first
   - API: GET /api/countries?sendable=true
   ↓
4. REMITTANCE BANK SELECTION SCREEN
   - Select payment gateway/bank
   - Shows available gateways for country
   - API: GET /api/payment-gateways?countryId=xxx
   ↓
5. REMITTANCE AMOUNT SCREEN
   - Enter send amount (USD)
   - App calculates:
     * Receive amount (destination currency)
     * Exchange rate
     * Fees and charges
   - API: POST /api/accounts/calculate-charge
   ↓
6. REMITTANCE RECIPIENT SCREEN
   - Enter recipient information:
     * Account number
     * Account holder name
     * Service provider
     * Source of fund
     * Sending purpose
   - Review transaction summary
   - Tap "Confirm Payment"
   ↓
7. PAYMENT FIELDS MODAL (if gateway requires)
   - Enter gateway-specific fields
   ↓
8. TRANSACTION CREATION
   - API: POST /api/remittance-transactions
   - Backend processes transaction
   ↓
9. SUCCESS SCREEN
   - Transaction ID
   - Transaction details
   - Option to view in Activity
```

### Transaction Creation Process

#### Step 1: Calculate Charge
**Endpoint**: `POST /api/accounts/calculate-charge`

**Request**:
```json
{
  "amount": 300.00,
  "currency": "USD",
  "countryId": "country_id",
  "transactionType": "remittance",
  "transferType": "bank"  // or "wallet"
}
```

**Backend Process** (`calculateTransactionFee`):
1. **Base Charge Calculation**:
   - Query `CountryCharge` table by `countryId`
   - Find matching charge level based on amount
   - Calculate: fixed amount OR percentage

2. **Tax/Fee Calculation**:
   - Query `TaxFee` table (status: 'Active')
   - Filter by country (if country-specific)
   - Filter by `applyTo` (bank/wallet/both)
   - Calculate tax and fee amounts
   - Support for dynamic tiers (different rates per amount range)

3. **Return Breakdown**:
```json
{
  "success": true,
  "data": {
    "amount": 300.00,
    "charge": 30.00,
    "breakdown": [
      {
        "name": "Base Charge",
        "type": "Fee",
        "value": 25.00,
        "valueType": "fixed",
        "amount": 25.00
      },
      {
        "name": "Transaction Tax",
        "type": "Tax",
        "value": 5.00,
        "valueType": "percentage",
        "amount": 5.00
      }
    ],
    "baseCharge": 25.00,
    "tax": 5.00,
    "fee": 25.00,
    "currency": "USD"
  }
}
```

#### Step 2: Create Transaction
**Endpoint**: `POST /api/remittance-transactions`

**Request**:
```json
{
  "sendAmount": 300.00,
  "receiveAmount": 12000.00,
  "currency": "ETB",
  "gatewayId": "gateway_id",
  "gatewayName": "Bank Name",
  "recipientInfo": {
    "accountNumber": "1234567890",
    "accountHolderName": "John Doe",
    "serviceProvider": "Bank Name",
    "sourceOfFund": "Salary",
    "sendingPurpose": "Family Support",
    "fee": 30.00,
    "feeBreakdown": [...]
  },
  "paymentFieldValues": {
    "field1": "value1",
    "field2": "value2"
  },
  "transferType": "bank",
  "countryId": "country_id"
}
```

**Backend Process** (`createRemittanceTransaction`):

1. **Authentication Check**:
   - Verify JWT token
   - Get customer from `req.user`

2. **KYC Verification**:
   - Check customer has at least one approved KYC document
   - Query `customers.kycData` (JSON field)
   - Block if no approved KYC

3. **Validation**:
   - Validate amounts (must be positive numbers)
   - Validate required fields

4. **Balance Check**:
   - Calculate total to debit: `sendAmount + totalCharge`
   - Check `customers.availableBalance >= totalDebit`
   - Return error if insufficient balance

5. **Orchestration Check**:
   - Call `runOrchestrationBeforeTransaction(context)`
   - Creates `orchestration_jobs` record
   - Validates transaction is allowed
   - Returns `{ allowed: true/false }`

6. **Atomic Database Transaction**:
```javascript
await prisma.$transaction([
  // Create transaction record
  prisma.remittanceTransaction.create({
    data: {
      customerId: customerId,
      type: 'Sent',
      transferType: 'bank',
      sendAmount: 300.00,
      receiveAmount: 12000.00,
      currency: 'ETB',
      gatewayId: gatewayId,
      gatewayName: gatewayName,
      recipientInfo: recipientInfo,
      paymentFieldValues: paymentFieldValues,
      status: 'Processing'
    }
  }),
  // Debit customer balance
  prisma.$executeRaw`
    UPDATE customers 
    SET "availableBalance" = "availableBalance" - ${totalDebit}
    WHERE id = ${customerId}
  `
]);
```

7. **Accounting Entry Creation**:
   - Call `createAccountingEntryFromTransaction(transaction)`
   - Creates multiple journal entries (see Accounting Documentation)

8. **Response**:
```json
{
  "success": true,
  "data": {
    "transaction": {
      "id": "transaction_id",
      "sendAmount": 300.00,
      "receiveAmount": 12000.00,
      "status": "Processing",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    "newBalance": 700.00  // Updated customer balance
  }
}
```

### Transaction Status Updates

**Statuses**:
- `Processing`: Transaction created, pending completion
- `Completed`: Transaction completed, funds sent
- `Failed`: Transaction failed, funds refunded

**Status Update Flow**:
- Admin updates status in dashboard
- Backend calls `updateAccountingEntriesForTransactionStatus()`
- Creates settlement entries (Completed) or reversal entries (Failed)

---

## KYC Verification Flow

### KYC Process

```
1. KYC INTRO SCREEN
   - Information about KYC requirements
   - Why KYC is needed
   ↓
2. KYC REGISTRATION DETAILS SCREEN
   - Fill KYC form fields
   - Fields depend on KYCForm configuration
   - API: GET /api/kyc/forms?country=USD
   ↓
3. KYC DOCUMENT SCREEN
   - Upload ID documents
   - Take photo or select from gallery
   - Upload: ID front, ID back, Selfie, Proof of Address
   ↓
4. KYC BANK DETAILS SCREEN (if required)
   - Enter bank account information
   ↓
5. SUBMIT KYC
   - API: POST /api/kyc/submit
   - Upload documents to server
   ↓
6. KYC PENDING SCREEN
   - Status: "Pending Review"
   - Wait for admin approval
   ↓
7. ADMIN REVIEW (Dashboard)
   - Admin reviews documents
   - Approve or Reject
   ↓
8. NOTIFICATION
   - User receives push notification
   - Status updated in app
```

### KYC API Flow

#### Get KYC Forms
**Endpoint**: `GET /api/kyc/forms`

**Query Parameters**:
- `country`: Country code (e.g., "USD")
- `for`: "User" or "Merchant"

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "form_id",
      "name": "Valid forms of Customer identifications (ID) USD",
      "description": "Required for wallet activation",
      "priority": 1,
      "maxAmount": 1000.00,
      "fields": [
        {
          "id": "field1",
          "fieldName": "id_type",
          "inputType": "select",
          "validationType": "required"
        },
        {
          "id": "field2",
          "fieldName": "id_number",
          "inputType": "text",
          "validationType": "required"
        }
      ],
      "countries": ["USD", "CAD"]
    }
  ]
}
```

#### Submit KYC
**Endpoint**: `POST /api/kyc/submit`

**Request** (multipart/form-data):
```json
{
  "formId": "form_id",
  "fieldValues": {
    "id_type": "Passport",
    "id_number": "A1234567",
    "date_of_birth": "1990-01-01"
  },
  "documents": [
    {
      "fieldName": "id_front",
      "file": File,
      "documentType": "id_front"
    },
    {
      "fieldName": "selfie",
      "file": File,
      "documentType": "selfie"
    }
  ]
}
```

**Backend Process**:
1. Validate form fields
2. Upload documents to `uploads/kyc/` directory
3. Store document paths in database
4. Update `customers.kycData` (JSON field):
```json
{
  "formId": "form_id",
  "submittedAt": "2024-01-15T10:30:00Z",
  "status": "pending",
  "documents": [
    {
      "fieldName": "id_front",
      "path": "uploads/kyc/user_id_id_front.jpg",
      "documentType": "id_front"
    }
  ],
  "fieldValues": {
    "id_type": "Passport",
    "id_number": "A1234567"
  }
}
```

#### Admin Approval
**Endpoint**: `PUT /api/customers/:id/kyc-approve`

**Request**:
```json
{
  "kycData": {
    "status": "approved",
    "approvedBy": "admin_id",
    "approvedAt": "2024-01-16T09:00:00Z"
  }
}
```

**Database Changes**:
- Update `customers.kycData` JSON field
- Status changed to "approved"

---

## Wallet & Balance Management

### Balance Structure

**Customer Wallet**:
- `availableBalance`: Decimal(18,2) - Available balance in USD
- Updated when:
  - Transaction created: Balance decreases
  - Transaction refunded: Balance increases
  - Admin adds money: Balance increases

### View Balance

**Endpoint**: `GET /api/customers/me` or `GET /api/customers/:id`

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "customer_id",
    "email": "user@example.com",
    "availableBalance": 1000.00,
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

### Transaction Limits

**Endpoint**: `GET /api/customers/:id/limits`

**Response**:
```json
{
  "success": true,
  "data": {
    "level": "1",
    "perTransactionLimit": 5000.00,
    "dailyAmountLimit": 10000.00,
    "monthlyAmountLimit": 50000.00,
    "dailyCountLimit": 10,
    "maxBalance": 100000.00
  }
}
```

**Source**: `Levels` table - transaction limits based on user level

### Add Money (Future Feature)

**Note**: Currently, balance is managed by admin. Future implementation may include:
- Bank transfer
- Credit card
- Mobile money
- Cash deposit

---

## Transaction History & Activity

### View Transactions

**Endpoint**: `GET /api/remittance-transactions`

**Query Parameters**:
- `customerId`: Filter by customer (for admin)
- `status`: Filter by status
- `startDate`, `endDate`: Date range
- `limit`, `offset`: Pagination

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "transaction_id",
      "type": "Sent",
      "transferType": "bank",
      "sendAmount": 300.00,
      "receiveAmount": 12000.00,
      "currency": "ETB",
      "gatewayName": "Bank Name",
      "status": "Completed",
      "recipientInfo": {
        "accountNumber": "1234567890",
        "accountHolderName": "John Doe"
      },
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 50
}
```

### Activity Screen

**App Flow**:
1. User taps "Activity" on Home screen
2. App fetches transactions: `GET /api/remittance-transactions?customerId=me`
3. Display list of transactions
4. Tap transaction → View details

---

## Settings & Profile Management

### Profile Settings

**Screens**:
- Account Details
- Personal Information
- Security (Change Password, Change PIN, Biometric)
- Notification Settings

### Update Profile

**Endpoint**: `PUT /api/customers/:id`

**Request**:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "912345678",
  "address": "123 Main St",
  "city": "New York"
}
```

### Change Password

**Endpoint**: `POST /api/customers/change-password`

**Request**:
```json
{
  "currentPassword": "old_password",
  "newPassword": "new_password"
}
```

### Change PIN

**Endpoint**: `POST /api/customers/change-pin`

**Request**:
```json
{
  "currentPin": "1234",
  "newPin": "5678"
}
```

---

## Support & Communication

### In-App Chat

**Feature**: Real-time chat with admin/support

**Flow**:
1. User taps "Chat with Admin"
2. Socket.io connection established
3. Messages stored in `messages` table
4. Real-time message delivery

**API**:
- `GET /api/messages`: Get chat history
- `POST /api/messages`: Send message
- Socket.io events: `message`, `message:received`

### FAQs

**Endpoint**: `GET /api/faqs`

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "faq_id",
      "question": "How do I send money?",
      "answer": "To send money, go to Remittance screen...",
      "order": 1
    }
  ]
}
```

### Help & Support

**Screens**:
- Help Support Screen
- FAQs Screen
- Contact Information

---

## Data Flow Diagrams

### Registration Data Flow

```
Mobile App
    ↓
POST /api/accounts/send-otp
    ↓
Backend: Generate OTP, Send SMS/Email
    ↓
Mobile App: User enters OTP
    ↓
POST /api/accounts/verify-otp
    ↓
Backend: Create Customer record
    ↓
Database: INSERT INTO customers
    ↓
Response: JWT token + user data
    ↓
Mobile App: Store token, navigate to Home
```

### Transaction Data Flow

```
Mobile App: User initiates send
    ↓
POST /api/accounts/calculate-charge
    ↓
Backend: Calculate fees (CountryCharge + TaxFee)
    ↓
Response: Charge breakdown
    ↓
Mobile App: User confirms payment
    ↓
POST /api/remittance-transactions
    ↓
Backend: Orchestration check
    ↓
Backend: Atomic transaction:
    - INSERT remittance_transactions
    - UPDATE customers.availableBalance
    ↓
Backend: Create accounting entries
    ↓
Database: INSERT INTO accounting_entries (multiple)
    ↓
Socket.io: Emit 'accounting:updated'
    ↓
Response: Transaction created + new balance
    ↓
Mobile App: Show success screen
```

### KYC Data Flow

```
Mobile App: User submits KYC
    ↓
POST /api/kyc/submit (multipart/form-data)
    ↓
Backend: Upload documents to uploads/kyc/
    ↓
Backend: Update customers.kycData (JSON)
    ↓
Database: UPDATE customers SET kycData = {...}
    ↓
Response: KYC submitted, status: pending
    ↓
Admin Dashboard: Review KYC
    ↓
PUT /api/customers/:id/kyc-approve
    ↓
Database: UPDATE customers.kycData.status = 'approved'
    ↓
Push Notification: KYC approved
    ↓
Mobile App: User can now make transactions
```

---

## API Integration

### Base URLs

**Remittance Backend**:
- Development: `http://localhost:3000/api`
- Production: `https://api.remittance.com/api`

### Authentication

**Header Format**:
```
Authorization: Bearer <jwt_token>
```

**Token Storage**:
- Stored in AsyncStorage: `AUTH_TOKEN`
- Sent with every API request

### API Services

**Location**: `remitance-app/src/services/`

**Files**:
- `auth/auth.js`: Authentication APIs
- `chargeService.js`: Charge calculation
- `remittanceAPI.js`: Remittance transaction APIs
- `customerAPI.js`: Customer/profile APIs

### Error Handling

**Standard Error Response**:
```json
{
  "success": false,
  "message": "Error message here",
  "error": "Detailed error information"
}
```

**HTTP Status Codes**:
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `500`: Internal Server Error

---

## Database Tables & Relationships

### Core Tables

#### customers
- Primary key: `id`
- Key fields: `email`, `phone`, `availableBalance`, `kycData`, `status`
- Relationships:
  - One-to-Many: `remittance_transactions`

#### remittance_transactions
- Primary key: `id`
- Foreign key: `customerId` → `customers.id`
- Key fields: `sendAmount`, `receiveAmount`, `status`, `recipientInfo`
- Relationships:
  - Many-to-One: `customers`
  - One-to-Many: `accounting_entries`

#### accounting_entries
- Primary key: `id`
- Foreign key: `remittanceTransactionId` → `remittance_transactions.id`
- Foreign key: `accountId` → `accounting_accounts.id`
- Key fields: `entryType`, `category`, `amount`, `status`

#### countries
- Primary key: `id`
- Key fields: `name`, `iso2`, `currencyCode`, `sendable`, `receivable`
- Relationships:
  - One-to-One: `country_charges`
  - One-to-Many: `country_services`

#### country_charges
- Primary key: `id`
- Foreign key: `countryId` → `countries.id`
- Key fields: `chargeLevels` (JSON array)

#### tax_fees
- Primary key: `id`
- Key fields: `name`, `type`, `valueType`, `value`, `applyTo`
- Relationships:
  - One-to-Many: `tax_fee_countries`

#### payment_gateways
- Primary key: `id`
- Key fields: `name`, `logo`, `status`, `paymentFields` (JSON)

#### kyc_forms
- Primary key: `id`
- Key fields: `name`, `fields` (JSON), `countries` (JSON), `priority`

### Data Relationships Diagram

```
customers (1) ──→ (N) remittance_transactions
                           │
                           │ (1)
                           ↓
                    (N) accounting_entries
                           │
                           │ (many-to-one)
                           ↓
                    accounting_accounts

countries (1) ──→ (1) country_charges
countries (1) ──→ (N) country_services
tax_fees (1) ──→ (N) tax_fee_countries
```

---

## Key Features Summary

### User Features
1. **Registration**: Phone/Email with OTP
2. **Authentication**: Password, PIN, Biometric
3. **KYC Verification**: Multi-step document upload
4. **Send Money**: International remittance
5. **Transaction History**: View all transactions
6. **Profile Management**: Update personal info
7. **Security**: Change password, PIN, enable biometric
8. **Support**: In-app chat, FAQs

### Business Logic
1. **Fee Calculation**: CountryCharge + TaxFee
2. **Balance Management**: Automatic debit on send
3. **KYC Enforcement**: Block transactions without approved KYC
4. **Transaction Limits**: Based on user level
5. **Orchestration**: Pre-transaction validation
6. **Accounting**: Automatic journal entries
7. **Real-time Updates**: Socket.io notifications

### Data Flow Summary
- **Registration**: OTP → Create Customer → JWT Token
- **Transaction**: Calculate Charge → Create Transaction → Debit Balance → Accounting Entries
- **KYC**: Upload Documents → Admin Review → Approval → Unlock Transactions
- **Balance**: Stored in `customers.availableBalance`, updated on transaction
- **Accounting**: Every transaction creates entries in `accounting_entries` table

---

## Conclusion

The Remittance App provides a complete end-to-end solution for international money transfers. The system ensures security through KYC verification, proper balance management, and comprehensive transaction tracking. All financial transactions are automatically recorded in the accounting system, providing complete auditability and financial transparency.
