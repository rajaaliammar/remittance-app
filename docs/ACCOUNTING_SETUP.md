# Accounting Tables Setup

The portal’s Accounting section (Dashboard, Entries, reports) needs the `accounting_entries` and `accounting_periods` tables. The Prisma schema already defines `AccountingEntry` and `AccountingPeriod`.

## Option 1: Migrations (recommended for production)

From the **Remittance_backend** directory:

```bash
npx prisma migrate dev --name add_accounting_tables
npx prisma generate
```

This creates a new migration and applies it. Use this when you use Prisma migrations for your DB.

## Option 2: DB push (quick setup, no migration history)

From the **Remittance_backend** directory:

```bash
npx prisma db push
npx prisma generate
```

This syncs the schema to the database without creating a migration file. Use this for local/dev when you don’t need migration history.

## Option 3: Run SQL manually

If you prefer not to use Prisma for these tables:

```bash
npx prisma db execute --file prisma/create_accounting_tables.sql
npx prisma generate
```

After any option, restart the backend so the Accounting API and app-transaction → accounting flow work.
