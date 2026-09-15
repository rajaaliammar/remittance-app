# Remittance Backend

Express.js backend application with Prisma ORM for the remittance system.
 
## Features

- **Orchestration layer** – Every remittance transaction runs through orchestration before balance debit; jobs and events are stored in `orchestration_jobs` and `orchestration_events`. See [docs/ORCHESTRATION.md](docs/ORCHESTRATION.md) for the technical checklist and developer note.
- Express.js web framework   
- Prisma ORM for database management
- PostgreSQL database support
- CORS enabled
- Request logging with Morgan
- Environment variable configuration
- Graceful shutdown handling

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL database
- npm or yarn  

## Installation
 
1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
```

3. Start PostgreSQL, PgBouncer, and Redis (optional but recommended):
```bash
npm run docker:up
```

4. Update `.env` with your database connection strings:
```
# Runtime → PgBouncer (port 6432); migrations → Postgres directly (5432)
DATABASE_URL="postgresql://postgres:password@localhost:6432/remittance_db?schema=public&pgbouncer=true"
DIRECT_DATABASE_URL="postgresql://postgres:password@localhost:5432/remittance_db?schema=public"
PRISMA_CONNECTION_LIMIT=10
```

For simple local dev without Docker, use port `5432` for both URLs (same value is fine).

5. Generate Prisma Client:
```bash
npm run prisma:generate
```

6. Run database migrations:
```bash
npm run prisma:migrate
```

## Running the Application

### Development mode (with auto-reload):
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

## Available Scripts

- `npm start` - Start the server in production mode
- `npm run dev` - Start the server in development mode with nodemon
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio (database GUI)
- `npm run prisma:seed` - Seed the database (if seed file exists)

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /api` - API information
- `GET /api/users` - Get all users (example endpoint)

## Project Structure

```
backend/
├── src/
│   ├── server.js          # Main server file
│   ├── routes/            # API routes
│   ├── controllers/       # Route controllers
│   ├── middleware/        # Custom middleware
│   ├── utils/             # Utility functions
│   └── prisma/            # Prisma related files
├── prisma/
│   └── schema.prisma      # Prisma schema
├── .env.example           # Environment variables template
├── .gitignore
├── package.json
└── README.md
```

## Database & connection pooling

```
Express (× N instances)
      ↓  DATABASE_URL (:6432, ?pgbouncer=true)
  PgBouncer  (transaction pool, ~25 server connections)
      ↓
  PostgreSQL (:5432)
```

- **Runtime queries** use `DATABASE_URL` through PgBouncer — many client connections multiplex onto a small Postgres pool.
- **Migrations / `prisma db push`** use `DIRECT_DATABASE_URL` (direct Postgres on port 5432).
- Set `PRISMA_CONNECTION_LIMIT` per API process (default `10`). Example: 5 servers × 10 = 50 app connections → PgBouncer holds ~25 Postgres connections.

```bash
npm run docker:up      # postgres + pgbouncer + redis
npm run docker:logs    # tail pooler / db logs
npm run docker:down
```

Bare-metal PgBouncer config: `pgbouncer/pgbouncer.ini` + `pgbouncer/userlist.txt`.

### Object storage (S3)

Uploads (KYC, agent docs, notification images, country service images) go to **Amazon S3** when `S3_ENABLED=true`. The API stores the public URL in the database — any server instance can read metadata; files are served from S3/CDN.

```
Upload → S3 → store URL in DB
```

Set `S3_PUBLIC_URL` to a CloudFront domain in production. Without S3, files stay on local disk under `uploads/` (single-server only).

### Socket.io across multiple servers

When running **2+ API instances** behind a load balancer, enable Redis so Socket.io broadcasts reach every server:

```
Client → Server A                    Client → Server B
              ↘                      ↙
            Redis pub/sub (@socket.io/redis-adapter)
```

Uses the same `REDIS_URL` as caching and BullMQ. Set `SOCKET_REDIS_ADAPTER=false` to disable (single-instance dev).

Chat, transaction status, KYC updates, and admin notifications all use `io.emit()` / `io.to(room)` — the adapter forwards these across instances automatically.

### Image storage (no base64 in PostgreSQL)

Logos, flags, and CMS images are uploaded to **S3** (or `/uploads/cms/`) and only the **URL** is stored in the database. The API automatically externalizes any legacy base64 sent by old clients on save.

```bash
npm run migrate:base64-images:dry-run   # preview
npm run migrate:base64-images             # convert existing rows
```

Portal uploads use `POST /api/upload/cms-image` → returns `{ url: "https://..." }`.


To create a new migration:
```bash
npm run prisma:migrate
```

**Accounting tables:** If the portal shows "Accounting tables must exist", run one of these in `Remittance_backend`:

- **With migrations:** `npx prisma migrate dev --name add_accounting_tables` then `npx prisma generate`
- **Quick setup (no migration history):** `npx prisma db push` then `npx prisma generate`

To view your database in Prisma Studio:
```bash
npm run prisma:studio
```

## License

ISC

