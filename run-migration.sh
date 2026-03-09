#!/bin/bash

# Script to run agent fields migration
# This will add all missing agent fields to the database

echo "Running Prisma migration to add agent fields..."
echo ""

# Option 1: Try Prisma DB Push (recommended for development)
echo "Attempting Prisma DB Push..."
npx prisma db push --accept-data-loss || {
    echo ""
    echo "Prisma DB Push failed. Trying Prisma Migrate..."
    echo ""
    
    # Option 2: Try Prisma Migrate
    npx prisma migrate dev --name add_agent_onboarding_fields_complete || {
        echo ""
        echo "Prisma Migrate failed. Please run the SQL file manually."
        echo ""
        echo "To run SQL manually, use:"
        echo "  psql \$DATABASE_URL -f prisma/migrations/add_agent_fields.sql"
        echo ""
        echo "Or connect to your database and run the SQL commands from:"
        echo "  prisma/migrations/add_agent_fields.sql"
        exit 1
    }
}

echo ""
echo "Regenerating Prisma Client..."
npx prisma generate

echo ""
echo "✅ Migration completed successfully!"
echo "Please restart your backend server for changes to take effect."
