# Utilities Module APIs

The Utilities module provides supporting services for AML (Anti-Money Laundering) operations. These APIs are not used for remittance transaction processing directly; instead, they manage reference data, validation, system configuration, and AML rule management.

---

## 1. Get Last Update Date

### Endpoint

```http
GET /api/Utilities/last-update-date
```

### Description

Returns the timestamp of the most recent AML reference-data update. This allows the Remittance Backend to determine whether local AML dictionaries and configurations need to be refreshed.

### Request

No request body required.

### Response

```json
{
  "lastUpdate": "2024-03-09T12:00:00Z"
}
```

### Usage

Used by scheduled synchronization jobs or application startup processes to detect changes in AML reference data.

---

## 2. Validate IP Address

### Endpoint

```http
POST /api/Utilities/validate-ip
```

### Description

Validates whether a client IP address is allowed to access AML services or perform transactions.

### Request

```json
{
  "IpAddress": "127.0.0.1"
}
```

### Response

```json
{
  "isValid": true
}
```

### Usage

Called before transaction processing to identify blocked, suspicious, or restricted IP addresses.

---

## 3. Get Maximum Occupation / Business Activity ID

### Endpoint

```http
GET /api/Utilities/max-occupation-id
```

### Description

Returns the highest occupation or business activity identifier currently stored in the AML system.

### Request

No request body required.

### Response

```json
254
```

### Usage

Used when creating new occupation or business activity records that require unique identifiers.

---

## 4. Create Business Activity

### Endpoint

```http
POST /api/Utilities/business-activity
```

### Description

Creates a new business activity category within the AML reference dictionary.

### Request

```json
{
  "id": 255,
  "name": "AI Consulting"
}
```

### Response

```json
{
  "status": "Saved"
}
```

### Usage

Used by administrative users to maintain AML business activity classifications.

---

## 5. Create Occupation

### Endpoint

```http
POST /api/Utilities/occupation
```

### Description

Adds a new occupation to the AML occupation master list.

### Request

```json
{
  "name": "Blockchain Developer"
}
```

### Response

```json
{
  "success": true
}
```

### Usage

Used during AML dictionary maintenance when new occupation categories must be introduced.

---

## 6. Get Active AML Rules

### Endpoint

```http
GET /api/Utilities/active-rules
```

### Description

Returns all AML rules that are currently active and enforced during transaction screening and risk assessment.

### Request

No request body required.

### Response

```json
[
  {
    "id": 1,
    "rule": "DailyTransferLimit"
  },
  {
    "id": 2,
    "rule": "HighRiskCountry"
  }
]
```

### Usage

Used by the AML decision engine to determine which compliance validations must be executed during transaction processing.

---

## Integration Flow

```text
Customer Application
        ↓
Remittance Backend
        ↓
AML Utilities APIs
        ├── GET /last-update-date
        ├── POST /validate-ip
        ├── GET /active-rules
        ├── POST /occupation
        ├── POST /business-activity
        └── GET /max-occupation-id
        ↓
AML Screening & Risk Assessment
        ↓
Approve / Hold / Reject Transaction
```

## Recommended Backend Layer

```text
Remittance Backend
│
├── Transaction Service
├── Customer Service
├── KYC Service
├── AML Service
│   ├── Validate IP
│   ├── Load Active Rules
│   ├── Manage Occupations
│   ├── Manage Business Activities
│   └── Synchronize Dictionaries
│
└── Database
```

These APIs should typically be consumed by the Remittance Backend or administrative systems. Direct access from client applications should generally be restricted.
