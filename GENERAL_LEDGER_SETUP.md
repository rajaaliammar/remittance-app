# General Ledger Setup Guide

## Overview
The General Ledger is a comprehensive accounting feature that provides a complete view of all accounts, their debits, credits, and balances. It organizes all financial transactions by account and provides detailed reporting capabilities.

## Features

### Backend Features
- ✅ Complete General Ledger API endpoint
- ✅ Account filtering by type, code, date range
- ✅ Automatic debit/credit calculation based on account type
- ✅ Entry mapping to accounts based on category
- ✅ Multi-currency support
- ✅ Zero balance filtering option

### Frontend Features
- ✅ Interactive General Ledger table
- ✅ Date range filtering with presets
- ✅ Account type and code search
- ✅ Currency selection
- ✅ Expandable rows to view entries per account
- ✅ Summary statistics (Total Debits, Credits, Balance)
- ✅ CSV export functionality
- ✅ Responsive design

## Setup Instructions

### 1. Database Migration

First, ensure the database schema is up to date:

```bash
cd Remittance_backend
npx prisma migrate dev --name add_accounting_2_features
npx prisma generate
```

### 2. Seed Chart of Accounts

Initialize the Chart of Accounts with standard accounting accounts:

```bash
cd Remittance_backend
node prisma/seed-accounts.js
```

This will create accounts for:
- **Assets** (1000-1999): Cash, Accounts Receivable, Customer Wallets, etc.
- **Liabilities** (2000-2999): Accounts Payable, Agent Commissions Payable, etc.
- **Equity** (3000-3999): Owner Equity, Retained Earnings, etc.
- **Revenue** (4000-4999): Transaction Fees, Service Fees, Commission Revenue, etc.
- **Expenses** (5000-5999): Gateway Fees, Operational Costs, Refunds, etc.

### 3. Link Existing Entries to Accounts

Existing accounting entries will be automatically mapped to accounts based on their category and entry type. The mapping logic:

- **Transaction Fees** → Account 4000 (Transaction Fees Revenue)
- **Tax** → Account 4000 (Transaction Fees Revenue)
- **Commission** → Account 4200 (Commission Revenue)
- **Gateway Fees** → Account 5000 (Gateway Fees)
- **Operational Costs** → Account 5300 (Operational Costs)
- **Refunds** → Account 5400 (Refunds)

### 4. Access General Ledger

Navigate to: **Accounting → General Ledger** in the dashboard sidebar.

## Usage

### Viewing the General Ledger

1. **Select Date Range**: Choose the period you want to view
2. **Filter by Account Type**: Filter by Asset, Liability, Equity, Revenue, or Expense
3. **Search by Account Code**: Enter account code to find specific accounts
4. **Select Currency**: View ledger in USD, PKR, EUR, or GBP
5. **Include Zero Balance**: Toggle to show/hide accounts with no activity

### Understanding the Display

- **Debits**: Shown in green for accounts that have debit balances
- **Credits**: Shown in red for accounts that have credit balances
- **Balance**: Shows Dr (Debit) or Cr (Credit) with the amount
- **Entries**: Click the expand icon to see all transactions for an account

### Exporting Data

Click the "Export CSV" button to download a complete General Ledger report including:
- All accounts with their codes and names
- Debits, credits, and balances
- Summary totals
- Date range information

## Account Types and Debit/Credit Rules

### Assets (1000-1999)
- **Increases** = Debits
- **Decreases** = Credits
- Normal balance: Debit

### Liabilities (2000-2999)
- **Increases** = Credits
- **Decreases** = Debits
- Normal balance: Credit

### Equity (3000-3999)
- **Increases** = Credits
- **Decreases** = Debits
- Normal balance: Credit

### Revenue (4000-4999)
- **Increases** = Credits
- **Decreases** = Debits
- Normal balance: Credit

### Expenses (5000-5999)
- **Increases** = Debits
- **Decreases** = Credits
- Normal balance: Debit

## API Endpoint

### GET /api/accounting/general-ledger

**Query Parameters:**
- `startDate` (optional): Start date (YYYY-MM-DD)
- `endDate` (optional): End date (YYYY-MM-DD)
- `accountType` (optional): Filter by account type (asset, liability, equity, revenue, expense)
- `accountCode` (optional): Search by account code
- `currency` (optional): Currency code (default: USD)
- `includeZeroBalance` (optional): Include accounts with zero balance (default: false)

**Response:**
```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "id": "...",
        "accountCode": "4000",
        "accountName": "Transaction Fees Revenue",
        "accountType": "revenue",
        "debits": 0,
        "credits": 1500.00,
        "balance": -1500.00,
        "entryCount": 25,
        "entries": [...]
      }
    ],
    "summary": {
      "totalDebits": 5000.00,
      "totalCredits": 5000.00,
      "totalBalance": 0,
      "currency": "USD",
      "accountCount": 10
    }
  }
}
```

## Troubleshooting

### No Accounts Showing
- Ensure you've run the seed script: `node prisma/seed-accounts.js`
- Check that accounts have status 'active'
- Verify date range includes transaction dates

### Entries Not Showing
- Check that accounting entries exist for the date range
- Verify entries are not marked as 'reversed'
- Ensure currency matches selected currency

### Balance Calculations Incorrect
- Verify account types are correctly set
- Check that debit/credit logic matches account type
- Review entry amounts and currencies

## Next Steps

After setting up the General Ledger, you can:
1. Create custom accounts for your specific needs
2. Link entries to specific accounts manually
3. Use the General Ledger for financial reporting
4. Export data for external accounting systems
