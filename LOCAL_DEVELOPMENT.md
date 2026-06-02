# Local development — portal + mobile app + one database

All customer data lives in **PostgreSQL** via this backend. The portal and Archive app must call **the same API URL** or signups will not appear in the portal.

## Start the stack

```bash
# Terminal 1 — API (port 3001)
cd Remittance_backend && npm run dev

# Terminal 2 — Admin portal (port 5173)
cd Remittence-portal && npm run dev

# Terminal 3 — Mobile app (emulator, local API)
cd Archive && npm run cap:run:android:local
```

## Environment alignment

| App | Config | API |
|-----|--------|-----|
| **Remittence-portal** | `.env` → `VITE_API_URL=http://localhost:3001` | Local |
| **Archive (emulator)** | `.env.development` → `VITE_ANDROID_API_URL=http://10.0.2.2:3001` | Local |
| **Archive (physical phone)** | Set `VITE_ANDROID_API_URL=http://YOUR_MAC_IP:3001` then rebuild | Local |
| **Production** | Portal `VITE_REMOTE_API=true`, Archive `npm run build:android:prod` | Live |

## Verify

- Open http://localhost:3001/health — `stats.customerCount` should match the portal Customer page total.
- After signup in the app (step 3 phone verify), the portal list refreshes automatically via Socket.IO (`customers:updated`).

## Signup flow

`POST /api/accounts/signup/` creates a **pending** customer row immediately. The portal lists all customers from `GET /api/customers`.
