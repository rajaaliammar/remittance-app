# Orchestration Layer – Developer Note & Technical Checklist

This document describes how the **orchestration layer** is integrated in the Remittance backend and how it maps to a standard transaction-orchestration checklist. Use it for code reviews, onboarding, and compliance.

---

## 1. Confirmation: Is Orchestration Used for Every Transaction?

**Yes.** All customer-initiated **send** (remittance) transactions go through a single path:

| Entry point | Route | Orchestration |
|-------------|--------|----------------|
| Create remittance (app "Confirm Payment") | `POST /api/remittance-transactions` | **Yes** – orchestration runs before the atomic DB transaction |

- **Controller:** `createRemittanceTransaction` in `src/controllers/remittanceTransaction.controller.js`.
- **Orchestration:** `runOrchestrationBeforeTransaction()` in `src/utils/orchestration.js` is called **before** every balance-debit and transaction create.
- **Balance updates:** The only place that debits `customers.availableBalance` for a send is inside `createRemittanceTransaction`, and that path always runs orchestration first.

So: **every remittance transaction that debits the customer balance passes through the orchestration layer.**

---

## 2. Database Tables (Orchestration & Related)

These tables exist and are used as described.

### Orchestration tables (from schema / DB)

| Table | Purpose |
|-------|---------|
| `orchestration_jobs` | One row per pre-transaction orchestration run (type, status, context, result, optional link to `remittance_transactions.id`). |
| `orchestration_events` | Events per job (e.g. `orchestration_started`, `orchestration_completed`, `orchestration_denied`). |

### Other transaction-related tables

| Table | Role |
|-------|------|
| `customers` | Holds `availableBalance` (wallet balance); debited atomically with transaction create. |
| `remittance_transactions` | Main transaction record (send/receive amounts, fees, status, recipient info). |
| `levels` | User levels and `transactionLimits` (daily/monthly/per-transaction) – used for tier limits. |
| `country_charges` | Country-level charge rules (fee rules). |
| `tax_fees` / `tax_fee_countries` | Tax/fee rules applied to transactions. |

**Not present in this codebase (optional for a full wallet-style system):**  
`ledger_entries`, `wallet_holds`, `idempotency_keys`, `transaction_logs` / `failure_logs` as separate tables. The current design uses `remittance_transactions` as the transaction record and `orchestration_jobs` / `orchestration_events` for orchestration audit.

---

## 3. Mandatory Steps – Current Implementation

| Stage | Checklist item | Status in this backend |
|-------|----------------|------------------------|
| **1. Check** | Auth validation | Done – `authenticateCustomer` middleware. |
| | PIN / biometric | Handled in app; backend trusts auth. |
| | Account status | KYC check (at least one approved doc) before transaction. |
| | Balance check | Done – balance and `totalToDeduct` checked before orchestration and atomic block. |
| **2. Rules** | Tier limits (daily/monthly) | Done – `getCustomerLimits` + `getSentInPeriod` (Level.transactionLimits). |
| | KYC max amount | Done – `getApprovedKYCMaxAmount`. |
| **3. Price** | Fee calculation | Done – `calculateTransactionFee` (country + tax/fee); total sent before confirmation. |
| | Response before confirmation | Fees and totals are computed and validated before the atomic transaction. |
| **4. Orchestration** | Central pre-transaction step | Done – `runOrchestrationBeforeTransaction()` runs for every create. |
| | Persisted jobs/events | Done – `orchestration_jobs` and `orchestration_events` when tables exist. |
| **5. Move** | Atomic transfer | Done – single `prisma.$transaction([ create remittance, update customers.availableBalance ])`. |
| **6. Record** | Transaction record | Done – `remittance_transactions` row with amounts, fees, status. |
| **7. Reserve / Hold** | Balance hold, idempotency | Not implemented – no `wallet_holds` or `idempotency_keys` table. |
| **8. Ledger** | Double-entry ledger | Not implemented – no separate `ledger_entries`; `remittance_transactions` is the record. |
| **9. Notify / Recovery** | Notifications, retries, reversal | Handled elsewhere (e.g. receipt); no change to orchestration flow here. |

---

## 4. Logging – When Orchestration Runs

Orchestration and transaction flow log to the console so you can confirm each run:

- **When orchestration starts (controller):**  
  `[Orchestration] createRemittanceTransaction: entering orchestration phase | customerId= ... | sendAmount= ... | totalToDeduct= ...`
- **Inside orchestration (utils):**  
  `[Orchestration] runOrchestrationBeforeTransaction started | customerId= ... | sendAmount= ... | currency= ... | transferType= ...`
- **Orchestration result (allowed/denied):**  
  `[Orchestration] runOrchestrationBeforeTransaction` then either `ALLOWED` or `DENIED`, and  
  `[Orchestration] createRemittanceTransaction: orchestration result | allowed= ...`
- **After success:**  
  `[Orchestration] createRemittanceTransaction: job linked to transaction | jobId= ... | transactionId= ...`  
  `[Orchestration] createRemittanceTransaction: completed successfully | transactionId= ...`

Search logs for `[Orchestration]` to verify orchestration is executed on every transaction.

---

## 5. Developer Note (Copy Into Codebase / README)

You can add the following as a comment or README section:

```text
ORCHESTRATION LAYER
------------------
- All remittance send transactions go through POST /api/remittance-transactions (createRemittanceTransaction).
- Orchestration runs BEFORE every such transaction: runOrchestrationBeforeTransaction() in src/utils/orchestration.js.
- Jobs and events are stored in orchestration_jobs and orchestration_events when the tables exist.
- Balance debit and transaction create are done in a single DB transaction (atomic).
- Do not debit customers.availableBalance or create remittance_transactions outside this path; otherwise orchestration is bypassed.
- See docs/ORCHESTRATION.md for the full checklist and table list.
```

---

## 6. Final Verdict (This Backend)

| Criterion | Status |
|-----------|--------|
| All relevant transactions pass through one path | Yes – createRemittanceTransaction only. |
| Orchestration runs before each transaction | Yes – runOrchestrationBeforeTransaction. |
| No balance change outside DB transaction | Yes – debit only inside prisma.$transaction. |
| Orchestration jobs/events stored | Yes – orchestration_jobs, orchestration_events. |
| Hold / reservation layer | No – no wallet_holds. |
| Idempotency keys table | No – optional for future. |
| Double-entry ledger table | No – remittance_transactions is the record. |

**Summary:** The orchestration layer **is integrated** for every remittance transaction: one entry point, orchestration always runs before the atomic move, and jobs/events are persisted. Reserve/hold, idempotency, and double-entry ledger are not implemented; see table and checklist above for details.
