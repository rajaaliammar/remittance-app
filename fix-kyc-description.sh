#!/bin/bash

# Script to fix KYC description field issue
# This script will:
# 1. Run the migration to add description column
# 2. Regenerate Prisma client

echo "🔧 Fixing KYC Description Field..."
echo ""

cd "$(dirname "$0")"

echo "Step 1: Running database migration..."
npx prisma migrate deploy
if [ $? -ne 0 ]; then
    echo "❌ Migration failed. Trying migrate dev instead..."
    npx prisma migrate dev --name add_description_to_kyc_forms
fi

echo ""
echo "Step 2: Regenerating Prisma client..."
npx prisma generate

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Success! Description field should now work."
    echo "⚠️  Please restart your backend server for changes to take effect."
else
    echo ""
    echo "❌ Failed to regenerate Prisma client. Please check the error above."
fi
