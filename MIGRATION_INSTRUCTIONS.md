# Database Migration Required

The Agent model schema has been updated with new fields, but the database needs to be migrated.

## To fix the error:

Run the following command in the Remittance_backend directory:

```bash
npx prisma migrate dev --name add_agent_onboarding_fields
```

Or if you want to create the migration file first:

```bash
npx prisma migrate dev --name add_agent_onboarding_fields --create-only
npx prisma migrate deploy
```

## New fields added to Agent model:
- businessName
- country
- city
- gender
- dateOfBirth
- businessType
- businessLicenseNumber
- taxIdentification
- businessAddress
- idType
- nationalIdFront
- nationalIdBack
- passportPhoto
- businessLicenseFile
- selfiePhoto
- shopPhoto
- inviteToken
- inviteTokenExp
- invitedBy
- invitedAt
- profileCompletedAt

The password field is now optional (nullable).
