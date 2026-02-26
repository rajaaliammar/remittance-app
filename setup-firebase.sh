#!/bin/bash

# Script to help set up Firebase Admin for push notifications

echo "🔥 Firebase Admin Setup for Push Notifications"
echo "=============================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating one..."
    touch .env
    echo "✅ Created .env file"
    echo ""
fi

# Check if Firebase service account file exists
SERVICE_ACCOUNT_FILES=$(find . -maxdepth 1 -name "*firebase-adminsdk*.json" -o -name "firebase-service-account.json" 2>/dev/null)

if [ -z "$SERVICE_ACCOUNT_FILES" ]; then
    echo "❌ Firebase service account JSON file not found in current directory"
    echo ""
    echo "📋 To get the service account file:"
    echo "   1. Go to: https://console.firebase.google.com/"
    echo "   2. Select project: super-app-71711"
    echo "   3. Go to: Project Settings > Service Accounts"
    echo "   4. Click: 'Generate new private key'"
    echo "   5. Save the downloaded file as: firebase-service-account.json"
    echo "   6. Place it in: $(pwd)/"
    echo ""
    echo "   Then run this script again."
    echo ""
    exit 1
fi

# Find the service account file
SERVICE_ACCOUNT_FILE=$(echo "$SERVICE_ACCOUNT_FILES" | head -1)
echo "✅ Found service account file: $SERVICE_ACCOUNT_FILE"

# Get absolute path
ABSOLUTE_PATH=$(cd "$(dirname "$SERVICE_ACCOUNT_FILE")" && pwd)/$(basename "$SERVICE_ACCOUNT_FILE")
RELATIVE_PATH="./$(basename "$SERVICE_ACCOUNT_FILE")"

echo ""
echo "📝 Checking .env file..."

# Check if FIREBASE_SERVICE_ACCOUNT_PATH is already set
if grep -q "FIREBASE_SERVICE_ACCOUNT_PATH" .env; then
    echo "⚠️  FIREBASE_SERVICE_ACCOUNT_PATH already exists in .env"
    echo "   Current value:"
    grep "FIREBASE_SERVICE_ACCOUNT_PATH" .env
    echo ""
    read -p "Do you want to update it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Remove old line
        sed -i.bak '/FIREBASE_SERVICE_ACCOUNT_PATH/d' .env
        echo "FIREBASE_SERVICE_ACCOUNT_PATH=$RELATIVE_PATH" >> .env
        echo "✅ Updated FIREBASE_SERVICE_ACCOUNT_PATH in .env"
    else
        echo "ℹ️  Keeping existing value"
    fi
else
    # Add to .env
    echo "" >> .env
    echo "# Firebase Admin SDK for push notifications" >> .env
    echo "FIREBASE_SERVICE_ACCOUNT_PATH=$RELATIVE_PATH" >> .env
    echo "✅ Added FIREBASE_SERVICE_ACCOUNT_PATH to .env"
fi

# Verify the JSON file is valid
echo ""
echo "🔍 Validating service account file..."
if command -v node &> /dev/null; then
    node -e "
        const fs = require('fs');
        try {
            const content = fs.readFileSync('$SERVICE_ACCOUNT_FILE', 'utf8');
            const key = JSON.parse(content);
            if (key.project_id && key.private_key && key.client_email) {
                console.log('✅ Valid Firebase service account file');
                console.log('   Project ID:', key.project_id);
                console.log('   Client Email:', key.client_email);
            } else {
                console.log('❌ Invalid service account file: missing required fields');
                process.exit(1);
            }
        } catch (e) {
            console.log('❌ Invalid JSON file:', e.message);
            process.exit(1);
        }
    "
else
    echo "⚠️  Node.js not found, skipping validation"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Restart your backend server"
echo "   2. You should see: [PUSH] ✅ Firebase Admin initialized successfully"
echo "   3. Test by sending a notification"
echo ""
echo "🔍 To verify, run: node check-push-config.js"
