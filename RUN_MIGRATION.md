# Run Agent Fields Migration

## Problem
The agent fields are defined in the Prisma schema but may not exist in the database yet, causing data to show as "—" (dash) in the UI.

## Solution

Run the following commands to add all agent fields to the database:

### Option 1: Using Prisma Migrate (Recommended)

```bash
cd Remittance_backend
npx prisma migrate dev --name add_agent_onboarding_fields_complete
npx prisma generate
```

### Option 2: Using Prisma DB Push (Faster, for development)

```bash
cd Remittance_backend
npx prisma db push
npx prisma generate
```

### Option 3: Run SQL Migration Manually

If the above commands don't work, you can run the SQL migration file directly:

```bash
cd Remittance_backend
# Connect to your database and run:
psql -U your_username -d your_database -f prisma/migrations/add_agent_fields.sql

# Or if using MySQL:
mysql -u your_username -p your_database < prisma/migrations/add_agent_fields.sql
```

## What This Does

This migration adds all the following fields to the `agents` table:

### Business Details:
- `businessName` - Business name
- `businessType` - Type of business (shop, forex, agent, mobile_shop)
- `businessLicenseNumber` - License number
- `taxIdentification` - TIN number
- `businessAddress` - Business address
- `dollarRate` - Dollar rate per USD (DECIMAL 18,4)
- `commissionRate` - Commission percentage (DECIMAL 5,2)

### Personal Details:
- `country` - Country
- `city` - City
- `gender` - Gender
- `dateOfBirth` - Date of birth

### Document Uploads:
- `idType` - ID type (national_id, passport)
- `nationalIdFront` - National ID front image URL
- `nationalIdBack` - National ID back image URL
- `passportPhoto` - Passport photo URL
- `businessLicenseFile` - Business license file URL
- `selfiePhoto` - Selfie photo URL
- `shopPhoto` - Shop photo URL

### Document Status Fields:
- `nationalIdFrontStatus` - Status (pending/approved/rejected)
- `nationalIdBackStatus` - Status
- `passportPhotoStatus` - Status
- `businessLicenseFileStatus` - Status
- `selfiePhotoStatus` - Status
- `shopPhotoStatus` - Status

### Other Fields:
- `onboardingData` - JSON field for temporary data storage
- `profileCompletedAt` - Timestamp when profile was completed
- `totalCommissionEarned` - Total commissions earned

## After Migration

1. **Regenerate Prisma Client**: `npx prisma generate`
2. **Restart your backend server**
3. **Refresh the agent profile page** - All fields should now display properly

## Verify Migration

After running the migration, you can verify by:

1. Checking the database directly:
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'agents' 
ORDER BY column_name;
```

2. Or check in Prisma Studio:
```bash
npx prisma studio
```

Then navigate to the `agents` table and verify all fields are present.
