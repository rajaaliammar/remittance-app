#!/usr/bin/env node

/**
 * Diagnostic script to check push notification configuration
 * Run: node check-push-config.js
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Checking Push Notification Configuration...\n');

// Check 1: Environment variables
console.log('1️⃣ Checking environment variables...');
const firebasePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 
                     process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!firebasePath) {
  console.log('   ❌ FIREBASE_SERVICE_ACCOUNT_PATH or GOOGLE_APPLICATION_CREDENTIALS not set');
  console.log('   💡 Set one of these environment variables to the path of your Firebase service account JSON file');
} else {
  console.log('   ✅ Found:', firebasePath);
  
  // Check 2: File exists
  const resolved = path.isAbsolute(firebasePath)
    ? firebasePath
    : path.resolve(process.cwd(), firebasePath);
  
  if (!fs.existsSync(resolved)) {
    console.log('   ❌ File does not exist:', resolved);
    console.log('   💡 Make sure the path is correct');
  } else {
    console.log('   ✅ File exists:', resolved);
    
    // Check 3: Valid JSON
    try {
      const content = fs.readFileSync(resolved, 'utf8');
      const key = JSON.parse(content);
      
      if (!key.project_id) {
        console.log('   ❌ Invalid service account file: missing project_id');
      } else {
        console.log('   ✅ Valid JSON file');
        console.log('   📦 Project ID:', key.project_id);
        console.log('   📧 Client Email:', key.client_email || 'N/A');
        
        // Check required fields
        const required = ['type', 'project_id', 'private_key', 'client_email'];
        const missing = required.filter(field => !key[field]);
        if (missing.length > 0) {
          console.log('   ❌ Missing required fields:', missing.join(', '));
        } else {
          console.log('   ✅ All required fields present');
        }
      }
    } catch (e) {
      console.log('   ❌ Invalid JSON file:', e.message);
    }
  }
}

// Check 4: Firebase Admin package
console.log('\n2️⃣ Checking Firebase Admin package...');
try {
  const admin = await import('firebase-admin');
  console.log('   ✅ firebase-admin is installed');
  
  // Try to initialize
  if (firebasePath && fs.existsSync(path.resolve(process.cwd(), firebasePath))) {
    try {
      const resolved = path.isAbsolute(firebasePath)
        ? firebasePath
        : path.resolve(process.cwd(), firebasePath);
      const key = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      
      if (admin.default.apps.length === 0) {
        admin.default.initializeApp({ credential: admin.default.credential.cert(key) });
        console.log('   ✅ Firebase Admin initialized successfully');
        
        // Test messaging
        const messaging = admin.default.messaging();
        console.log('   ✅ Firebase Messaging is available');
      } else {
        console.log('   ✅ Firebase Admin already initialized');
      }
    } catch (e) {
      console.log('   ❌ Failed to initialize Firebase Admin:', e.message);
    }
  }
} catch (e) {
  console.log('   ❌ firebase-admin package not found');
  console.log('   💡 Install it with: npm install firebase-admin');
}

// Check 5: Database connection (optional)
console.log('\n3️⃣ Checking database connection...');
try {
  const { default: prisma } = await import('./src/utils/prisma.js');
  await prisma.$connect();
  console.log('   ✅ Database connection successful');
  
  // Check if customer table exists and has fcmToken field
  try {
    const sample = await prisma.customer.findFirst({
      select: { id: true, fcmToken: true }
    });
    if (sample) {
      console.log('   ✅ Customer table accessible');
      const withToken = await prisma.customer.count({
        where: { fcmToken: { not: null } }
      });
      console.log(`   📊 Customers with FCM tokens: ${withToken}`);
    }
  } catch (e) {
    console.log('   ⚠️  Could not query customer table:', e.message);
  }
  
  await prisma.$disconnect();
} catch (e) {
  console.log('   ⚠️  Could not connect to database:', e.message);
  console.log('   💡 This is optional - push notifications can work without database');
}

console.log('\n✅ Diagnostic complete!');
console.log('\n💡 Common issues:');
console.log('   1. Missing FIREBASE_SERVICE_ACCOUNT_PATH environment variable');
console.log('   2. Invalid or expired Firebase service account file');
console.log('   3. Customer has no FCM token (app needs to be opened and logged in)');
console.log('   4. Invalid or expired FCM token');
console.log('   5. Network/firewall blocking Firebase API calls');
