# Ledger Integration Documentation

This document describes the integration with the external ledger API for remittance transactions.

## Overview

The ledger integration automatically creates journal entries in an external ledger system for every remittance transaction across three phases:

1. **Phase 1 - Remittance Initiate**: When a transaction is created
2. **Phase 2 - Remittance Complete**: When a transaction is marked as completed
3. **Phase 3 - Remittance Refund**: When a transaction is rejected/refunded

## Environment Variables

Add the following environment variables to your `.env` file:

```env
# Ledger API Configuration
LEDGER_BASE_URL=http://demo3.appliedline.com
LEDGER_TOKEN_REMITTANCE_INITIATE=<LEDGER_TOKEN_REMITTANCE_INITIATE>
LEDGER_TOKEN_REMITTANCE_COMPLETE=<LEDGER_TOKEN_REMITTANCE_COMPLETE>
LEDGER_TOKEN_REMITTANCE_REFUND=<LEDGER_TOKEN_REMITTANCE_REFUND>
```

### Configuration Details

- **LEDGER_BASE_URL**: Base URL for the ledger API (default: `http://demo3.appliedline.com`)
- **LEDGER_TOKEN_REMITTANCE_INITIATE**: Bearer token for Phase 1 (initiate) journal entries
- **LEDGER_TOKEN_REMITTANCE_COMPLETE**: Bearer token for Phase 2 (complete) journal entries
- **LEDGER_TOKEN_REMITTANCE_REFUND**: Bearer token for Phase 3 (refund) journal entries

**Note**: If any token is not configured, the corresponding phase will be skipped with a warning log, but the transaction will still proceed.

## Integration Points

### Phase 1: Remittance Initiate

**Location**: `src/controllers/remittanceTransaction.controller.js` → `createRemittanceTransaction()`

**Triggered**: When a customer creates a remittance transaction (POST `/api/remittance-transactions`)

**Journal Entries Created**:
- Credit: `WALLET_LIABILITY` (customer) - Total deducted (principal + fee)
- Debit: `REMITTANCE_PAYABLE` (transaction) - Principal amount
- Debit: `FEE_REVENUE` (platform) - Fee amount

**Example**:
```json
{
  "externalId": "txn_1772644220_remittance_initiate_v1",
  "type": "remittance_initiate",
  "currency": "USD",
  "entries": [
    {
      "account": { "type": "WALLET_LIABILITY", "refId": "customer_123" },
      "credit": 330.00,
      "narration": "Total deducted from sender (300 principal + 30 fee)"
    },
    {
      "account": { "type": "REMITTANCE_PAYABLE", "refId": "txn_1772644220" },
      "debit": 300.00,
      "narration": "Payout obligation to beneficiary"
    },
    {
      "account": { "type": "FEE_REVENUE", "refId": "platform" },
      "debit": 30.00,
      "narration": "Transfer fee earned"
    }
  ]
}
```

### Phase 2: Remittance Complete

**Location**: `src/controllers/remittanceTransaction.controller.js` → `updateRemittanceTransaction()`

**Triggered**: When an admin updates a transaction status to "Completed" (PUT `/api/remittance-transactions/:id`)

**Journal Entries Created**:
- Credit: `REMITTANCE_PAYABLE` (transaction) - Clear USD obligation
- Debit: `FX_CLEARING` (transaction) - USD moved to FX pool
- Credit: `FX_CLEARING` (transaction) - Destination currency at cost rate
- Debit: `SETTLEMENT_CLEARING` (payout partner) - Destination currency disbursed
- Debit: `FX_GAIN_REVENUE` (platform) - FX spread captured (if applicable)

**Example**:
```json
{
  "externalId": "txn_1772644220_remittance_complete_v1",
  "type": "remittance_complete",
  "currency": "USD",
  "entries": [
    {
      "account": { "type": "REMITTANCE_PAYABLE", "refId": "txn_1772644220" },
      "credit": 300.00,
      "currency": "USD",
      "narration": "USD payout obligation cleared"
    },
    {
      "account": { "type": "FX_CLEARING", "refId": "txn_1772644220" },
      "debit": 300.00,
      "currency": "USD",
      "narration": "USD moved into FX conversion pool"
    },
    {
      "account": { "type": "FX_CLEARING", "refId": "txn_1772644220" },
      "credit": 17250.00,
      "currency": "ETB",
      "narration": "ETB sourced at cost rate 57.50 (300 × 57.50)"
    },
    {
      "account": { "type": "SETTLEMENT_CLEARING", "refId": "payout_partner_id" },
      "debit": 17100.00,
      "currency": "ETB",
      "narration": "ETB disbursed to payout partner at offered rate 57.00 (300 × 57.00)"
    },
    {
      "account": { "type": "FX_GAIN_REVENUE", "refId": "platform" },
      "debit": 150.00,
      "currency": "ETB",
      "narration": "FX spread captured (17250 - 17100 ETB)"
    }
  ]
}
```

**Note**: Phase 2 requires exchange rate information. The system will:
1. Use `transaction.exchangeRate` if available
2. Calculate from `receiveAmount / sendAmount` if not stored
3. Extract `costRate` and `offeredRate` from `paymentFieldValues` if available
4. Use calculated exchange rate as fallback

### Phase 3: Remittance Refund

**Location**: `src/controllers/remittanceTransaction.controller.js` → `rejectRemittanceTransaction()`

**Triggered**: When an admin rejects a transaction (POST `/api/remittance-transactions/:id/reject`)

**Journal Entries Created**:
- Credit: `REMITTANCE_PAYABLE` (transaction) - Clear obligation
- Credit: `FEE_REVENUE` (platform) - Reverse fee
- Debit: `WALLET_LIABILITY` (customer) - Refund total to customer

**Example**:
```json
{
  "externalId": "txn_1772644220_remittance_refund_v1",
  "type": "remittance_refund",
  "currency": "USD",
  "entries": [
    {
      "account": { "type": "REMITTANCE_PAYABLE", "refId": "txn_1772644220" },
      "credit": 300.00,
      "narration": "Payout obligation cleared on refund"
    },
    {
      "account": { "type": "FEE_REVENUE", "refId": "platform" },
      "credit": 30.00,
      "narration": "Fee reversed on refund"
    },
    {
      "account": { "type": "WALLET_LIABILITY", "refId": "customer_123" },
      "debit": 330.00,
      "narration": "Full refund returned to customer wallet"
    }
  ]
}
```

## API Endpoints

### Update Transaction Status

**Endpoint**: `PUT /api/remittance-transactions/:id`

**Authentication**: Required (admin/backoffice token)

**Request Body**:
```json
{
  "status": "Completed"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Transaction updated successfully",
  "data": { ... }
}
```

**Note**: When status is updated to "Completed", Phase 2 ledger entry is automatically created.

## Error Handling

- If ledger API calls fail, errors are logged but **do not fail the transaction**
- Transactions will proceed even if ledger integration is unavailable
- All ledger API calls are wrapped in try-catch blocks
- Warnings are logged when tokens are not configured

## Logging

The ledger service logs the following:
- Success: `[Ledger Service] Phase X journal created for transaction {id}`
- Warnings: `[Ledger Service] LEDGER_TOKEN_* not configured, skipping journal entry`
- Errors: `[Ledger Service] Failed to create Phase X journal for {id}: {error}`

## Testing

To test the integration:

1. **Phase 1**: Create a new remittance transaction via the mobile app or API
2. **Phase 2**: Update a transaction status to "Completed" using the update endpoint
3. **Phase 3**: Reject a transaction using the reject endpoint

Check the logs to verify ledger API calls are being made successfully.

## Troubleshooting

### Ledger entries not being created

1. Check that environment variables are set correctly
2. Verify tokens are valid and have proper permissions
3. Check server logs for error messages
4. Verify ledger API base URL is accessible

### Phase 2 missing exchange rate information

1. Ensure `exchangeRate` is stored in the transaction when created
2. Or ensure `costRate` and `offeredRate` are in `paymentFieldValues`
3. The system will calculate from amounts as fallback, but may not be accurate

### Transactions failing

- Ledger integration failures should NOT cause transaction failures
- If transactions are failing, check other error sources
- Ledger errors are logged but do not block transaction processing
