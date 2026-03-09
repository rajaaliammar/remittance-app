# Add Dollar Rate Field Migration

## Problem
The `dollarRate` field was added to the schema but the database migration hasn't been run yet, causing the error:
```
Unknown argument `dollarRate`. Available options are marked with ?.
```

## Solution

Run the following commands to add the `dollarRate` column to the database:

```bash
cd Remittance_backend
npx prisma migrate dev --name add_agent_dollar_rate
npx prisma generate
```

Or if you want to create the migration file without applying it:

```bash
npx prisma migrate dev --name add_agent_dollar_rate --create-only
```

Then review the migration file and apply it:

```bash
npx prisma migrate deploy
npx prisma generate
```

## What This Does

1. Creates a migration file that adds the `dollarRate` column to the `agents` table
2. The column will be: `DECIMAL(18, 4)` to support rates like 57.00 or 57.5000
3. Regenerates the Prisma client so it recognizes the new field

## Temporary Workaround

Until the migration is run, the code will:
- Save `dollarRate` in the `onboardingData` JSON field
- Handle the error gracefully and continue with the onboarding process
- Once the migration is run, `dollarRate` will be saved in its own column

## After Migration

After running the migration, the `dollarRate` will be:
- Saved directly to the `agents.dollarRate` column
- Available in all agent queries
- Properly typed as a Decimal field
