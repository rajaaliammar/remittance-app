# Push Notification Fix

## Problem
The `/api/customers/:id/send-notification` endpoint was returning a 502 error with a generic message:
```json
{
  "success": false,
  "message": "Failed to deliver notification (device may be offline or token invalid). Notification is saved and will show in the app.",
  "saved": true,
  "pushed": false,
  "reason": "Push delivery failed"
}
```

## Changes Made

### 1. Improved Error Handling (`src/utils/push.js`)
- Changed return value from `boolean` to an object with detailed error information
- Added specific error codes for different failure scenarios
- Enhanced logging with error codes and messages
- Better handling of Firebase-specific error codes

### 2. Enhanced API Response (`src/controllers/customer.controller.js`)
- Now returns detailed error information including:
  - `errorCode`: Specific Firebase error code
  - `errorDetails`: Detailed error message
  - `reason`: Human-readable error message

## Common Error Codes

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `FIREBASE_NOT_CONFIGURED` | Firebase Admin not initialized | Set `FIREBASE_SERVICE_ACCOUNT_PATH` or `GOOGLE_APPLICATION_CREDENTIALS` |
| `NO_TOKEN` | Customer has no FCM token | Customer needs to open app and log in |
| `messaging/registration-token-not-registered` | Token is invalid/expired | Clear token from customer record, customer needs to re-login |
| `messaging/invalid-registration-token` | Token format is invalid | Clear token from customer record |
| `messaging/message-rate-exceeded` | Too many messages sent | Wait and retry later |
| `messaging/unavailable` | Firebase service unavailable | Retry later |
| `messaging/internal-error` | Firebase internal error | Check Firebase status, retry later |

## Troubleshooting

### 1. Check Firebase Configuration
Run the diagnostic script:
```bash
cd Remittance_backend
node check-push-config.js
```

### 2. Verify Environment Variables
Make sure you have one of these set:
```bash
export FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
# OR
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### 3. Check Server Logs
Look for `[PUSH]` and `[Notification]` log messages:
- `[PUSH] ✅ Firebase Admin initialized successfully` - Good
- `[PUSH] ⚠️ Firebase Admin not configured` - Bad, need to set env var
- `[PUSH] ❌ sendPushToToken failed` - Check error code and message

### 4. Verify Customer Has FCM Token
Check the database:
```sql
SELECT id, email, fcmToken IS NOT NULL as has_token 
FROM Customer 
WHERE id = 'customer_id';
```

### 5. Test with Valid Token
If customer has a token but it's failing:
- Token might be expired (app was uninstalled/reinstalled)
- Token might be from a different Firebase project
- Device might be offline

## Next Steps

1. **Check server logs** when sending a notification - you'll now see detailed error information
2. **Run the diagnostic script** to verify Firebase configuration
3. **Check the API response** - it now includes `errorCode` and `errorDetails` fields
4. **Verify customer FCM token** - make sure the customer has opened the app and logged in

## Testing

After the fix, when you send a notification, you'll get a response like:

**Success:**
```json
{
  "success": true,
  "message": "Notification sent to customer's app.",
  "saved": true,
  "pushed": true
}
```

**Failure with details:**
```json
{
  "success": false,
  "message": "Device token is invalid or not registered. The user may have uninstalled the app. Notification is saved and will show in the app.",
  "saved": true,
  "pushed": false,
  "reason": "Device token is invalid or not registered. The user may have uninstalled the app.",
  "errorCode": "messaging/registration-token-not-registered",
  "errorDetails": "..."
}
```

This gives you much better visibility into what's going wrong!
