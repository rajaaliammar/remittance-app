# Accounting Module - Complete Backend Documentation

## Table of Contents
1. [Overview](#overview)
2. [Database Schema & Tables](#database-schema--tables)
3. [Data Flow & Transaction Processing](#data-flow--transaction-processing)
4. [How Dollars Are Sent to Users](#how-dollars-are-sent-to-users)
5. [Accounting Entry Creation](#accounting-entry-creation)
6. [Double-Entry Bookkeeping System](#double-entry-bookkeeping-system)
7. [Chart of Accounts](#chart-of-accounts)
8. [API Endpoints](#api-endpoints)
9. [Transaction Status Updates](#transaction-status-updates)
10. [Reconciliation & Reporting](#reconciliation--reporting)

---

## Overview

The Accounting Module is a comprehensive double-entry bookkeeping system that automatically tracks all financial transactions in the remittance platform. Every remittance transaction creates corresponding accounting entries, ensuring complete financial transparency and auditability.

**⚠️ Implementation Status**: This documentation describes the **CURRENT** implementation. Most features are fully functional, with one noted limitation regarding automatic settlement entries (see Transaction Status Updates section).

### Key Features
- **Automatic Entry Creation**: Every remittance transaction automatically generates accounting entries
- **Double-Entry Bookkeeping**: All transactions follow proper debit/credit accounting principles
- **Chart of Accounts**: Organized account structure (Assets, Liabilities, Revenue, Expenses)
- **Multi-Currency Support**: All entries recorded in USD (base currency)
- **Real-time Updates**: Socket.io events notify dashboard of accounting changes
- **Comprehensive Reporting**: Balance sheets, profit/loss, cash flow, general ledger, subsidiary ledger

---

## Database Schema & Tables

### Core Accounting Tables

#### 1. `accounting_entries` (AccountingEntry Model)
**Purpose**: Stores all financial transactions as journal entries

**Key Fields**:
- `id`: Unique entry identifier
- `entryType`: Type of entry (`revenue`, `expense`, `fee`, `commission`, `refund`)
- `category`: Detailed category (e.g., `transaction_fee`, `cash_collection`, `remittance_payable`, `gateway_fee`)
- `amount`: Transaction amount (Decimal 18,2)
- `currency`: Currency code (default: `USD`)
- `description`: Human-readable description
- `referenceType`: Source of entry (`remittance_transaction`, `payment`, `withdrawal`, `manual`)
- `referenceId`: ID of the referenced transaction
- `remittanceTransactionId`: Foreign key to `remittance_transactions`
- `status`: Entry status (`pending`, `completed`, `reversed`)
- `accountId`: Foreign key to `accounting_accounts` (Chart of Accounts)
- `createdBy`: BackofficeUser ID for manual entries
- `exchangeRate`: Exchange rate used at transaction time
- `walletBalanceBefore`: Customer wallet balance before transaction
- `walletBalanceAfter`: Customer wallet balance after transaction
- `createdAt`, `updatedAt`: Timestamps

**Indexes**:
- `entryType`, `category`, `referenceType + referenceId`, `remittanceTransactionId`, `createdAt`, `accountId`

#### 2. `accounting_accounts` (AccountingAccount Model)
**Purpose**: Chart of Accounts - organized account structure

**Key Fields**:
- `id`: Unique account identifier
- `accountCode`: Unique account code (e.g., "1000", "2000", "4000")
- `accountName`: Account name (e.g., "Cash (Collection)", "Remittance Payable")
- `accountType`: Account type (`asset`, `liability`, `equity`, `revenue`, `expense`)
- `parentId`: Parent account ID for hierarchical structure
- `status`: Account status (`active`, `inactive`)

**Standard Account Codes**:
- **1000**: Cash (Collection) - Asset
- **1100**: Settlement Clearing - Asset
- **1200**: Customer Wallets - Asset
- **2000**: Remittance Payable - Liability
- **2300**: Tax Payable - Liability
- **4000**: Fee Revenue - Revenue
- **4200**: Commission Revenue - Revenue
- **5000**: Gateway / Corridor Fees - Expense
- **5300**: Operational Costs - Expense
- **5400**: Refunds Expense - Expense

#### 3. `accounting_periods` (AccountingPeriod Model)
**Purpose**: Track financial periods for reporting

**Key Fields**:
- `id`: Unique period identifier
- `periodType`: Period type (`daily`, `weekly`, `monthly`, `yearly`)
- `periodStart`, `periodEnd`: Period date range
- `totalRevenue`, `totalExpenses`, `totalFees`, `netProfit`: Aggregated values
- `currency`: Currency code
- `status`: Period status (`open`, `closed`, `locked`)

#### 4. `remittance_transactions` (RemittanceTransaction Model)
**Purpose**: Core transaction table - linked to accounting entries

**Key Fields**:
- `id`: Unique transaction identifier
- `customerId`: Foreign key to `customers`
- `type`: Transaction type (`Sent`, `Received`)
- `transferType`: Transfer channel (`bank`, `wallet`)
- `sendAmount`: Amount sent (in USD)
- `receiveAmount`: Amount received (in destination currency)
- `currency`: Destination currency code
- `gatewayId`, `gatewayName`: Payment gateway information
- `recipientInfo`: JSON with recipient details, fee breakdown
- `paymentFieldValues`: JSON with gateway-specific fields
- `status`: Transaction status (`Processing`, `Completed`, `Failed`)
- `exchangeRate`: Exchange rate at transaction time
- `createdAt`, `updatedAt`: Timestamps

**Relationship**: One transaction can have multiple accounting entries

#### 5. `customers` (Customer Model)
**Purpose**: Customer/user information

**Key Fields**:
- `id`: Unique customer identifier
- `availableBalance`: Wallet balance (Decimal 18,2) - **deducted on send**
- `email`, `phone`, `firstName`, `lastName`: Customer details
- `kycData`: JSON with KYC document information
- `status`: Customer status (`pending`, `approved`, `rejected`)

---

## Data Flow & Transaction Processing

### Complete Transaction Flow

```
1. USER INITIATES TRANSACTION (Mobile App)
   ↓
2. App calculates charge (POST /api/accounts/calculate-charge)
   - Uses CountryCharge (base fee)
   - Applies TaxFee from portal settings
   - Returns: totalCharge, breakdown, tax, fee
   ↓
3. User confirms payment → POST /api/remittance-transactions
   ↓
4. ORCHESTRATION LAYER (runOrchestrationBeforeTransaction)
   - Validates customer, amounts
   - Checks KYC approval
   - Creates orchestration_job record
   - Returns: { allowed: true/false }
   ↓
5. IF ALLOWED → ATOMIC DATABASE TRANSACTION:
   a. Create RemittanceTransaction record (status: "Processing")
   b. UPDATE customers.availableBalance (debit customer wallet)
   c. Link orchestration_job to transaction
   ↓
6. ACCOUNTING ENTRY CREATION (createAccountingEntryFromTransaction)
   - Automatically creates journal entries
   - Multiple entries per transaction (double-entry)
   ↓
7. SOCKET.IO EVENT: 'accounting:updated'
   - Dashboard receives real-time notification
   - Refetches accounting data
   ↓
8. TRANSACTION STATUS UPDATES
   - When status changes to "Completed" → settlement entries
   - When status changes to "Failed"/"Refunded" → reversal entries
```

### Table Relationships

```
customers (1) ──→ (N) remittance_transactions
                           │
                           │ (1)
                           ↓
                    (N) accounting_entries
                           │
                           │ (many-to-one)
                           ↓
                    accounting_accounts (Chart of Accounts)
```

---

## How Dollars Are Sent to Users

### Step-by-Step Process

#### 1. **Customer Initiates Send Transaction**

**Mobile App Flow**:
- User selects country, gateway, enters amount
- App calls `POST /api/accounts/calculate-charge` to get fees
- User enters recipient information
- User confirms payment

**Backend Processing** (`createRemittanceTransaction`):
```javascript
// Location: src/controllers/remittanceTransaction.controller.js

1. Validate customer has approved KYC
2. Validate amounts (sendAmount, receiveAmount)
3. Calculate total charge (fee + tax)
4. Calculate total to debit: sendAmount + totalCharge
5. Check customer has sufficient balance
6. Run orchestration check
7. If allowed, create transaction in atomic DB transaction:
   - INSERT remittance_transactions
   - UPDATE customers SET availableBalance = availableBalance - totalDebit
```

#### 2. **Accounting Entry Creation**

**Automatic Entry Generation** (`createAccountingEntryFromTransaction`):
```javascript
// Location: src/utils/accounting.js

For a transaction: $300 send, $30 fee, $0 tax

ENTRIES CREATED:

1. Dr Cash (Collection) - $330
   - Account: 1000 (Cash)
   - Category: cash_collection
   - Description: "Cash collected – bank transfer ($300 + $30 fee → USD)"

2. Cr Remittance Payable - $300
   - Account: 2000 (Remittance Payable)
   - Category: remittance_payable
   - Description: "Remittance payable – bank transfer to USD"

3. Cr Fee Revenue - $30
   - Account: 4000 (Fee Revenue)
   - Category: transaction_fee
   - Description: "Fee revenue – bank transfer"

4. (If gateway fee exists) Dr Gateway Fees - $X
   - Account: 5000 (Gateway Fees)
   - Category: gateway_fee
```

#### 3. **Transaction Status: Processing → Completed**

**When Transaction Completes** (`updateAccountingEntriesForTransactionStatus`):

```javascript
// Location: src/utils/accounting.js

SETTLEMENT ENTRIES:

1. Mark original entries as "completed"

2. Dr Remittance Payable - $300
   - Account: 2000 (Remittance Payable)
   - Category: settlement_debit
   - Description: "Settlement – clear remittance payable"

3. Cr Settlement Clearing - $300
   - Account: 1100 (Settlement Clearing)
   - Category: settlement_credit
   - Description: "Settlement – funds disbursed to payout partner"
```

**What This Means**:
- The $300 liability (Remittance Payable) is cleared
- Funds are moved to Settlement Clearing account
- This represents funds sent to the payout partner/gateway
- The recipient receives the money through the gateway

#### 4. **Transaction Status: Failed/Refunded**

**Reversal Entries**:

```javascript
REVERSAL ENTRIES:

1. Mark original entries as "reversed"

2. Dr Remittance Payable - $300 (clear liability)
3. Dr Fee Revenue - $30 (reverse fee)
4. Cr Cash - $330 (refund to customer)

Result: Customer's availableBalance is restored
```

---

## Accounting Entry Creation

### Automatic Entry Creation Flow

**Trigger**: Every `POST /api/remittance-transactions` creates accounting entries

**Function**: `createAccountingEntryFromTransaction(transaction, status, opts)`

**Process**:

1. **Extract Transaction Data**:
   - `sendAmount`: Principal amount
   - `feeAmount`: Transaction fee
   - `taxAmount`: Tax amount
   - `expenseAmount`: Gateway/corridor fee
   - `totalCollected = sendAmount + feeAmount + taxAmount`

2. **Create Multiple Entries** (Double-Entry):
   - **Cash Collection** (Dr): Total collected from customer
   - **Remittance Payable** (Cr): Principal owed to recipient
   - **Fee Revenue** (Cr): Fee earned by company
   - **Tax Payable** (Cr): Tax collected (if any)
   - **Gateway Fees** (Dr): Cost to process (if any)

3. **Link to Chart of Accounts**:
   - Each entry resolves `accountId` from `accountCode`
   - Uses account mapping (ACCT constants)

4. **Persist Entries**:
   - Creates records in `accounting_entries` table
   - Links to `remittance_transactions` via `remittanceTransactionId`

### Entry Status Lifecycle

```
pending → completed (when transaction completes)
pending → reversed (when transaction fails/refunded)
```

---

## Double-Entry Bookkeeping System

### Accounting Principles

The system follows **double-entry bookkeeping** where every transaction has:
- **Debit (Dr)**: Left side - increases assets/expenses, decreases liabilities/revenue
- **Credit (Cr)**: Right side - increases liabilities/revenue, decreases assets/expenses

### Example: $300 Send Transaction

**Transaction Details**:
- Send Amount: $300
- Fee: $30
- Tax: $0
- Total Collected: $330

**Journal Entries**:

| Account | Type | Debit | Credit | Description |
|---------|------|-------|--------|-------------|
| Cash (Collection) | Asset | $330 | | Money received from customer |
| Remittance Payable | Liability | | $300 | Obligation to pay recipient |
| Fee Revenue | Revenue | | $30 | Fee earned by company |

**Balance Check**: Debits ($330) = Credits ($330) ✓

### Account Type Rules

**Assets** (1000-1999):
- Increase with Debit, Decrease with Credit
- Examples: Cash, Customer Wallets, Settlement Clearing

**Liabilities** (2000-2999):
- Increase with Credit, Decrease with Debit
- Examples: Remittance Payable, Tax Payable

**Revenue** (4000-4999):
- Increase with Credit, Decrease with Debit
- Examples: Fee Revenue, Commission Revenue

**Expenses** (5000-5999):
- Increase with Debit, Decrease with Credit
- Examples: Gateway Fees, Operational Costs

---

## Chart of Accounts

### Account Structure

The Chart of Accounts is organized by account type and code:

#### Assets (1000-1999)
- **1000**: Cash (Collection) - Money collected from customers
- **1100**: Settlement Clearing - Funds sent to payout partners
- **1200**: Customer Wallets - Customer available balances

#### Liabilities (2000-2999)
- **2000**: Remittance Payable - Money owed to recipients
- **2300**: Tax Payable - Tax collected, owed to government

#### Revenue (4000-4999)
- **4000**: Fee Revenue - Transaction fees earned
- **4200**: Commission Revenue - Agent commissions

#### Expenses (5000-5999)
- **5000**: Gateway / Corridor Fees - Cost to process transactions
- **5300**: Operational Costs - Operating expenses
- **5400**: Refunds Expense - Refunded amounts

### Account Resolution

**Function**: `resolveAccountId(accountCode)`

**Process**:
1. Checks in-memory cache first
2. Queries `accounting_accounts` table by `accountCode`
3. Returns account `id` for linking to entries
4. Caches result for performance

---

## API Endpoints

### Base Path: `/api/accounting`

All endpoints require authentication (`authenticateToken` middleware).

#### 1. **GET /api/accounting/summary**
**Purpose**: Get accounting summary statistics

**Query Parameters**:
- `startDate`: Start date (YYYY-MM-DD)
- `endDate`: End date (YYYY-MM-DD)
- `groupBy`: Group by period (`daily`, `weekly`, `monthly`, `yearly`, `none`)
- `entryType`: Filter by entry type
- `category`: Filter by category
- `currency`: Currency code (default: `USD`)

**Response**:
```json
{
  "success": true,
  "data": {
    "totalRevenue": 10000.00,
    "totalExpenses": 2000.00,
    "totalFees": 5000.00,
    "totalTransactionFee": 4500.00,
    "totalTax": 500.00,
    "netProfit": 8000.00,
    "profit": 8000.00,
    "loss": 0,
    "currency": "USD",
    "byPeriod": { "2024-01": { "revenue": 10000, "expenses": 2000 } }
  }
}
```

#### 2. **GET /api/accounting/entries**
**Purpose**: List accounting entries with pagination

**Query Parameters**:
- `limit`: Page size (default: 50, max: 2000)
- `offset`: Page offset (default: 0)
- `entryType`: Filter by entry type
- `category`: Filter by category
- `status`: Filter by status
- `referenceType`: Filter by reference type
- `startDate`, `endDate`: Date range
- `sortBy`: Sort field (default: `createdAt`)
- `sortOrder`: Sort order (`asc`, `desc`)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "entry_id",
      "entryType": "revenue",
      "category": "transaction_fee",
      "amount": 30.00,
      "currency": "USD",
      "description": "Fee revenue – bank transfer",
      "status": "completed",
      "remittanceTransaction": {
        "id": "txn_id",
        "sendAmount": 300.00,
        "status": "Completed"
      }
    }
  ],
  "total": 100
}
```

#### 3. **GET /api/accounting/general-ledger**
**Purpose**: Get general ledger report

**Query Parameters**:
- `startDate`, `endDate`: Date range
- `accountType`: Filter by account type
- `accountCode`: Filter by account code
- `currency`: Currency code
- `hideZeroBalance`: Hide accounts with zero balance

**Response**: Account-level summary with debits, credits, balances

#### 4. **GET /api/accounting/subsidiary-ledger**
**Purpose**: Get subsidiary ledger (detailed account entries)

**Query Parameters**:
- `accountId` or `accountCode`: Account to view
- `startDate`, `endDate`: Date range

**Response**: All entries for a specific account with running balance

#### 5. **GET /api/accounting/balance-sheet**
**Purpose**: Get balance sheet report

**Query Parameters**:
- `asOfDate`: Balance sheet date
- `currency`: Currency code

**Response**: Assets, Liabilities, Equity breakdown

#### 6. **GET /api/accounting/cash-flow**
**Purpose**: Get cash flow statement

**Query Parameters**:
- `startDate`, `endDate`: Period
- `currency`: Currency code

**Response**: Operating, Investing, Financing activities

#### 7. **GET /api/accounting/debit-credit**
**Purpose**: Get debit/credit summary with user breakdown

**Query Parameters**:
- `startDate`, `endDate`: Date range
- `currency`: Currency code

**Response**: Total debits, credits, breakdown by user

#### 8. **POST /api/accounting/entries**
**Purpose**: Create manual accounting entry

**Request Body**:
```json
{
  "entryType": "revenue",
  "category": "manual_adjustment",
  "amount": 100.00,
  "currency": "USD",
  "description": "Manual adjustment entry",
  "referenceType": "manual",
  "referenceId": null
}
```

#### 9. **GET /api/accounting/entries/:id**
**Purpose**: Get single accounting entry by ID

#### 10. **PUT /api/accounting/entries/:id**
**Purpose**: Update accounting entry

#### 11. **DELETE /api/accounting/entries/:id**
**Purpose**: Delete accounting entry (soft delete by marking as reversed)

#### 12. **GET /api/accounting/revenue/breakdown**
**Purpose**: Revenue breakdown by category/period

#### 13. **GET /api/accounting/expense/breakdown**
**Purpose**: Expense breakdown by category/period

#### 14. **GET /api/accounting/profit-loss**
**Purpose**: Profit & Loss statement

#### 15. **GET /api/accounting/reconcile**
**Purpose**: Reconciliation report (matched vs unmatched entries)

#### 16. **GET /api/accounting/export**
**Purpose**: Export accounting data (CSV/JSON)

#### 17. **POST /api/accounting/sync-from-transactions**
**Purpose**: Sync accounting entries from existing transactions

**Request Body**:
```json
{
  "startDate": "2024-01-01",
  "endDate": "2024-12-31"
}
```

#### 18. **POST /api/accounting/backfill-accounts**
**Purpose**: Link existing entries to Chart of Accounts

---

## Transaction Status Updates

### Status Flow

```
Processing → Completed (settlement entries created - via sync endpoint)
Processing → Failed (reversal entries created automatically on reject)
Processing → Refunded (reversal entries created)
Processing → Canceled (reversal entries created)
```

### Status Update Handler

**Function**: `updateAccountingEntriesForTransactionStatus(transactionId, newStatus)`

**Location**: `src/utils/accounting.js`

#### Completed Status

**Current Implementation**: 
- Settlement entries are **NOT automatically created** when transaction status changes to "Completed"
- To create settlement entries, use the sync endpoint: `POST /api/accounting/sync-from-transactions`
- The sync function will detect completed transactions and create settlement entries

**Actions** (when sync is run):
1. Mark all original entries as `status: 'completed'`
2. Create settlement entries:
   - **Dr Remittance Payable**: Clear the liability
   - **Cr Settlement Clearing**: Funds disbursed to payout partner

**Result**: Transaction is settled, funds are considered sent to recipient

**Note**: This is a current limitation - settlement entries require manual sync. Future enhancement could automatically trigger on status update.

#### Failed/Refunded/Canceled Status

**Current Implementation**: 
- **Automatically triggered** when admin rejects transaction via `POST /api/remittance-transactions/:id/reject`

**Actions**:
1. Mark all original entries as `status: 'reversed'`
2. Create reversal entries:
   - **Dr Remittance Payable**: Clear liability
   - **Dr Fee Revenue**: Reverse fee earned
   - **Cr Cash**: Refund total to customer
3. Refund customer balance (restored in `customers.availableBalance`)

**Result**: Customer balance is restored, transaction is reversed

**Code Location**: `src/controllers/remittanceTransaction.controller.js` - `rejectRemittanceTransaction` function (line 634)

---

## Reconciliation & Reporting

### Reconciliation Process

**Function**: `reconcileAccountingEntries(opts)`

**Purpose**: Verify accounting entries match transaction data

**Checks**:
1. **Fee Revenue Match**: Recorded fee = expected fee from transaction
2. **Cash Collected Match**: Recorded cash = sendAmount + fee
3. **Principal Match**: Recorded principal = sendAmount

**Output**:
- `matched`: Count of transactions with matching entries
- `unmatched`: Count of transactions with discrepancies
- `matchedDetails`: Array of matched transactions
- `unmatchedDetails`: Array of unmatched transactions with issues

### Sync Function

**Function**: `syncAccountingEntriesFromTransactions(opts)`

**Purpose**: Ensure all transactions have accounting entries

**Process**:
1. Find transactions without accounting entries
2. Create entries for missing transactions
3. Update entries for transactions that changed status

**Result**:
- `created`: Number of entries created
- `updated`: Number of entries updated
- `skipped`: Number of transactions skipped
- `errors`: Array of error messages

### Reporting Features

1. **Summary Dashboard**: Total revenue, expenses, profit
2. **General Ledger**: All accounts with debits/credits/balances
3. **Subsidiary Ledger**: Detailed entries per account
4. **Balance Sheet**: Assets, Liabilities, Equity
5. **Cash Flow Statement**: Operating, Investing, Financing
6. **Profit & Loss**: Revenue vs Expenses
7. **Reconciliation Report**: Matched vs Unmatched entries

---

## Real-Time Updates

### Socket.IO Integration

**Event**: `accounting:updated`

**Triggered When**:
- New accounting entry created
- Entry updated
- Entry deleted
- Transaction status changes

**Purpose**: Dashboard receives real-time notifications and refetches data

**Implementation**:
```javascript
// In controllers
const io = req.app && req.app.get && req.app.get('io');
if (io) {
  io.emit('accounting:updated');
}
```

---

## Key Files & Locations

### Backend Files

1. **Accounting Utils**: `src/utils/accounting.js`
   - Entry creation functions
   - Status update handlers
   - Reconciliation logic

2. **Accounting Controller**: `src/controllers/accounting.controller.js`
   - All API endpoint handlers
   - Reporting functions

3. **Accounting Routes**: `src/routes/accounting.routes.js`
   - Route definitions

4. **Transaction Controller**: `src/controllers/remittanceTransaction.controller.js`
   - Transaction creation (triggers accounting)

5. **Charge Utils**: `src/utils/chargeUtils.js`
   - Fee calculation logic

6. **Prisma Schema**: `prisma/schema.prisma`
   - Database models

7. **Account Seeding**: `prisma/seed-accounts.js`
   - Chart of Accounts initialization

---

## Summary

The Accounting Module provides:

1. **Automatic Tracking**: Every transaction creates accounting entries
2. **Double-Entry System**: Proper debit/credit accounting
3. **Chart of Accounts**: Organized account structure
4. **Complete Audit Trail**: All transactions tracked with timestamps
5. **Real-Time Updates**: Socket.io notifications for dashboard
6. **Comprehensive Reporting**: Balance sheets, P&L, cash flow, ledgers
7. **Reconciliation**: Verify entries match transactions
8. **Multi-Currency**: All entries in USD base currency

**Data Flow Summary**:
- Customer sends money → Transaction created → Customer balance debited
- Accounting entries created automatically (Cash Dr, Payable Cr, Revenue Cr)
- When transaction completes → Settlement entries (Payable Dr, Clearing Cr)
- Funds are sent to recipient through gateway/payout partner
- All entries linked to Chart of Accounts for reporting
