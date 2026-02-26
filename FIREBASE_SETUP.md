# Firebase Admin Setup for Push Notifications

## Problem
You're seeing this error:
```
[PUSH] ⚠️ Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS
```

## Solution: Get Firebase Service Account Key

### Step 1: Get Service Account JSON File

1. **Go to Firebase Console**
   - Visit: https://console.firebase.google.com/
   - Select your project: **super-app-71711** (from your google-services.json)

2. **Navigate to Project Settings**
   - Click the gear icon ⚙️ next to "Project Overview"
   - Select "Project settings"

3. **Go to Service Accounts Tab**
   - Click on the "Service accounts" tab
   - You'll see "Firebase Admin SDK"

4. **Generate New Private Key**
   - Click "Generate new private key" button
   - A warning dialog will appear - click "Generate key"
   - A JSON file will be downloaded (e.g., `super-app-71711-firebase-adminsdk-xxxxx.json`)

5. **Save the File**
   - Move the downloaded JSON file to your backend directory
   - Recommended location: `Remittance_backend/firebase-service-account.json`
   - ⚠️ **IMPORTANT**: Add this file to `.gitignore` (it contains sensitive credentials!)

### Step 2: Configure Environment Variable

Add one of these to your `.env` file in `Remittance_backend/`:

```bash
# Option 1: Relative path (recommended)
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json

# Option 2: Absolute path
FIREBASE_SERVICE_ACCOUNT_PATH=/full/path/to/firebase-service-account.json

# Option 3: Use GOOGLE_APPLICATION_CREDENTIALS (alternative)
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
```

### Step 3: Update .gitignore

Make sure your `.gitignore` includes:
```
firebase-service-account.json
*.json
!package.json
!package-lock.json
!tsconfig.json
```

### Step 4: Restart Your Server

After setting the environment variable, restart your backend server:

```bash
cd Remittance_backend
npm run dev
```

You should now see:
```
[PUSH] ✅ Firebase Admin initialized successfully
```

## Verify Setup

Run the diagnostic script:
```bash
cd Remittance_backend
node check-push-config.js
```

## Testing

After setup, try sending a notification again. You should see:
- `[PUSH] ✅ Firebase Admin initialized successfully`
- `[PUSH] 📤 Sending push notification to token: ...`
- `[PUSH] ✅ Push notification sent successfully`

## Troubleshooting

### File Not Found
- Make sure the path in `.env` is correct
- Use absolute path if relative path doesn't work
- Check file permissions (should be readable)

### Invalid JSON
- Make sure you downloaded the complete file
- Don't edit the JSON file manually
- Re-download if corrupted

### Permission Denied
- Check file permissions: `chmod 600 firebase-service-account.json`
- Make sure the file is readable by your Node.js process

### Still Not Working
1. Check server logs for `[PUSH]` messages
2. Verify the environment variable is loaded: `console.log(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)`
3. Run the diagnostic script: `node check-push-config.js`

## Security Notes

⚠️ **NEVER commit the service account JSON file to git!**

- The file contains private keys that give full access to your Firebase project
- Add it to `.gitignore` immediately
- If accidentally committed, rotate the keys in Firebase Console
- Use environment variables, not hardcoded paths in production
