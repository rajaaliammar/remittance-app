#!/bin/bash

# Script to fix isPopular field in countries table
# This adds the isPopular column to the countries table and regenerates the Prisma client

echo "🔧 Fixing isPopular field for countries..."
echo ""

cd "$(dirname "$0")"

echo "Step 1: Running Prisma migration to add isPopular column..."
npx prisma migrate deploy

echo ""
echo "Step 2: Regenerating Prisma client..."
npx prisma generate

echo ""
echo "✅ Fix applied successfully!"
echo "⚠️  Please restart your backend server for changes to take effect."
