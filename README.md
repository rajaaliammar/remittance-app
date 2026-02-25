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

3. Update `.env` with your database connection string:
```
DATABASE_URL="postgresql://user:password@localhost:5432/remittance_db?schema=public"
```

4. Generate Prisma Client:
```bash
npm run prisma:generate
```

5. Run database migrations:
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

## Database

This project uses Prisma with PostgreSQL. Update the `DATABASE_URL` in your `.env` file to connect to your database.

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

