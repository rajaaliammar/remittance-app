#!/bin/bash
# Print FIREBASE_SERVICE_ACCOUNT_JSON as a single line for production .env / hosting secrets.
set -e
cd "$(dirname "$0")/.."
FILE="${1:-./firebase-service-account.json}"
if [ ! -f "$FILE" ]; then
  echo "Missing: $FILE"
  echo "Download from: https://console.firebase.google.com/project/super-app-71711/settings/serviceaccounts/adminsdk"
  exit 1
fi
python3 -c "import json,sys; print('FIREBASE_SERVICE_ACCOUNT_JSON='+json.dumps(json.load(open(sys.argv[1]))))" "$FILE"
