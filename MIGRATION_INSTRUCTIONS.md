# Fix KYC Form Description Field

## Problem
The `description` field is not saving when editing or creating KYC forms. This happens because:
1. The database table is missing the `description` column (migration not run)
2. The Prisma client doesn't recognize the `description` field (needs regeneration)

## Quick Fix (Easiest Method)

Run the provided script:

```bash
cd backend
./fix-kyc-description.sh
```

Then restart your backend server.

## Manual Fix

Run these commands in the `backend` directory:

```bash
cd backend

# 1. Run the migration to add the description column
npx prisma migrate deploy

# OR if you're in development mode:
npx prisma migrate dev

# 2. Regenerate Prisma client to sync with the schema
npx prisma generate

# 3. Restart your backend server
```

## What the migration does
The migration file `20260217192612_add_description_to_kyc_forms/migration.sql` adds the `description` column to the `kyc_forms` table.

## Verification
After running the migration and regenerating Prisma:
1. Try to save a description in the KYC form edit page
2. The description should now save successfully
3. No more "Unknown argument `description`" errors

## Troubleshooting

If you still see errors after running the migration:
1. Make sure you're in the `backend` directory
2. Check that the migration file exists: `prisma/migrations/20260217192612_add_description_to_kyc_forms/migration.sql`
3. Verify Prisma client was regenerated: Check `node_modules/.prisma/client` was updated
4. Restart your backend server completely
