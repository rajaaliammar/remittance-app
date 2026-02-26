#!/bin/bash

# Script to create accounting tables in the database
# This fixes the error: "The table `public.accounting_entries` does not exist"

echo "🔧 Creating accounting tables..."

cd "$(dirname "$0")"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ Error: DATABASE_URL environment variable is not set"
  echo "   Please set it in your .env file or export it"
  exit 1
fi

echo "📦 Option 1: Using Prisma db push (recommended for development)..."
echo "   This will sync your schema to the database"
npx prisma db push --accept-data-loss || {
  echo ""
  echo "⚠️  Prisma db push failed. Trying Option 2..."
  echo ""
  echo "📦 Option 2: Running SQL file directly..."
  
  # Try using psql if available
  if command -v psql &> /dev/null; then
    echo "   Using psql to execute SQL file..."
    psql "$DATABASE_URL" -f prisma/create_accounting_tables.sql
  else
    echo "   Using Prisma db execute..."
    npx prisma db execute --file prisma/create_accounting_tables.sql --schema prisma/schema.prisma
  fi
}

echo ""
echo "🔄 Generating Prisma Client..."
npx prisma generate

echo ""
echo "✅ Done! The accounting tables should now exist."
echo "   You can verify by running: npx prisma studio"
echo ""
echo "💡 If you still see errors, try:"
echo "   1. Check your DATABASE_URL in .env"
echo "   2. Ensure your database is running"
echo "   3. Check database permissions"
