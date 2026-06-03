#!/bin/bash
set -e
cd "$(dirname "$0")"
TARGET="./firebase-service-account.json"
CONSOLE_URL="https://console.firebase.google.com/project/super-app-71711/settings/serviceaccounts/adminsdk"

echo "🔥 Firebase push setup — project super-app-71711"
echo ""
if [ -f "$TARGET" ]; then
  echo "✅ Already exists: $TARGET"
  node check-push-config.js 2>/dev/null | head -20
  exit 0
fi

echo "1. Opening Firebase Console in your browser..."
echo "2. Click: Generate new private key → Generate key"
echo "3. This script will copy the download into: $TARGET"
echo ""
open "$CONSOLE_URL" 2>/dev/null || echo "   Open manually: $CONSOLE_URL"
echo "Waiting for download (up to 5 minutes)..."

# Use any existing adminsdk download first (not only files from the last 10 minutes)
EXISTING=$(find "$HOME/Downloads" -maxdepth 1 -name '*firebase-adminsdk*.json' 2>/dev/null | head -1)
if [ -n "$EXISTING" ] && [ -f "$EXISTING" ]; then
  cp "$EXISTING" "$TARGET"
  chmod 600 "$TARGET"
  echo "✅ Installed: $TARGET (from $EXISTING)"
  node check-push-config.js 2>/dev/null | head -15
  echo "👉 Restart backend: npm run dev"
  exit 0
fi

for i in $(seq 1 150); do
  FILE=$(find "$HOME/Downloads" -maxdepth 1 -name '*firebase-adminsdk*.json' -mmin -2 2>/dev/null | head -1)
  if [ -n "$FILE" ] && [ -f "$FILE" ]; then
    cp "$FILE" "$TARGET"
    chmod 600 "$TARGET"
    echo ""
    echo "✅ Installed: $TARGET (from $FILE)"
    node -e "
      const k = require('./firebase-service-account.json');
      console.log('   Project:', k.project_id);
      console.log('   Email:', k.client_email);
    "
    echo ""
    echo "👉 Restart backend: npm run dev"
    exit 0
  fi
  sleep 2
done

echo "❌ Timed out. Save the JSON manually as: $(pwd)/firebase-service-account.json"
exit 1
