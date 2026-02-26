# Fix: Accounting Tables Don't Exist

## Error
```
The table `public.accounting_entries` does not exist in the current database.
```

## Quick Fix

### Option 1: Using Prisma db push (Recommended)
```bash
cd Remittance_backend
npx prisma db push
npx prisma generate
```

### Option 2: Run the SQL file directly
```bash
cd Remittance_backend

# If you have psql installed:
psql $DATABASE_URL -f prisma/create_accounting_tables.sql

# Or using Prisma:
npx prisma db execute --file prisma/create_accounting_tables.sql --schema prisma/schema.prisma

# Then generate Prisma client:
npx prisma generate
```

### Option 3: Use the provided script
```bash
cd Remittance_backend
./create-accounting-tables.sh
```

## What This Does

1. Creates the `accounting_entries` table with all required fields and indexes
2. Creates the `accounting_periods` table (optional, for period-based reporting)
3. Sets up foreign key relationship with `remittance_transactions`
4. Generates the Prisma client so your code can use the new models

## Verify It Worked

After running the migration, you can verify by:

1. **Check in Prisma Studio:**
   ```bash
   npx prisma studio
   ```
   You should see `accounting_entries` and `accounting_periods` tables.

2. **Test the API:**
   ```bash
   curl http://localhost:3001/api/accounting/summary
   ```
   Should return data instead of an error.

3. **Check database directly:**
   ```sql
   SELECT * FROM accounting_entries LIMIT 1;
   ```

## After Migration

Once the tables are created, you can:

1. **Sync existing transactions:**
   ```bash
   POST http://localhost:3001/api/accounting/sync-from-transactions?startDate=2026-01-27&endDate=2026-02-26
   ```

2. **View accounting entries:**
   ```bash
   GET http://localhost:3001/api/accounting/entries
   ```

## Troubleshooting

### If `npx` commands fail:
- Make sure you're in the `Remittance_backend` directory
- Check that `node_modules` exists: `ls node_modules/.bin/prisma`
- Try using the full path: `./node_modules/.bin/prisma db push`

### If database connection fails:
- Check your `.env` file has `DATABASE_URL` set correctly
- Ensure your database server is running
- Verify database credentials

### If tables still don't appear:
- Check database permissions
- Verify you're connected to the correct database
- Check Prisma schema matches: `cat prisma/schema.prisma | grep -A 20 AccountingEntry`
