/**
 * Test script to verify SMARTY API credentials
 * Run: node test-smarty-credentials.js
 */

import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const SMARTY_AUTOCOMPLETE_HOST = 'us-autocomplete-pro.api.smarty.com';

function httpsGet(urlString, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlString, (res) => {
      clearTimeout(timer);
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {};
          resolve({ statusCode: res.statusCode, data });
        } catch {
          resolve({ statusCode: res.statusCode, data: null });
        }
      });
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('Request timeout'));
    }, timeoutMs);
  });
}

async function testCredentials() {
  console.log('='.repeat(60));
  console.log('SMARTY API Credentials Test');
  console.log('='.repeat(60));
  console.log('');

  const authId = (process.env.SMARTY_AUTH_ID || '').trim();
  const authToken = (process.env.SMARTY_AUTH_TOKEN || '').trim();
  const apiKey = (process.env.SMARTY_API_KEY || '').trim();

  console.log('Checking environment variables...');
  console.log(`  SMARTY_AUTH_ID: ${authId ? '✓ Set (' + authId.length + ' chars)' : '✗ Not set'}`);
  console.log(`  SMARTY_AUTH_TOKEN: ${authToken ? '✓ Set (' + authToken.length + ' chars)' : '✗ Not set'}`);
  console.log(`  SMARTY_API_KEY: ${apiKey ? '✓ Set (' + apiKey.length + ' chars)' : '✗ Not set'}`);
  console.log('');

  if (!authId && !authToken && !apiKey) {
    console.error('❌ ERROR: No SMARTY credentials found!');
    console.error('');
    console.error('Please set one of the following in your .env file:');
    console.error('  1. SMARTY_AUTH_ID and SMARTY_AUTH_TOKEN (Secret Key - recommended)');
    console.error('  2. OR SMARTY_API_KEY (Public Key)');
    console.error('');
    console.error('Get credentials from: https://smarty.com/account/keys');
    process.exit(1);
  }

  const params = new URLSearchParams();
  if (authId && authToken) {
    params.set('auth-id', authId);
    params.set('auth-token', authToken);
    console.log('Using auth-id and auth-token for authentication');
  } else if (apiKey) {
    params.set('key', apiKey);
    console.log('Using API key for authentication');
  }

  // Test with a simple search
  params.set('search', 'washington');
  const urlString = `https://${SMARTY_AUTOCOMPLETE_HOST}/lookup?${params.toString()}`;
  
  console.log('');
  console.log('Testing API connection...');
  console.log(`URL: ${urlString.replace(/auth-id=[^&]+/g, 'auth-id=***').replace(/auth-token=[^&]+/g, 'auth-token=***').replace(/key=[^&]+/g, 'key=***')}`);
  console.log('');

  try {
    const result = await httpsGet(urlString, 10000);
    console.log(`Status Code: ${result.statusCode}`);
    
    if (result.statusCode === 200) {
      const suggestions = Array.isArray(result.data?.suggestions) 
        ? result.data.suggestions 
        : (Array.isArray(result.data) ? result.data : []);
      console.log(`✅ SUCCESS! Credentials are valid.`);
      console.log(`   Received ${suggestions.length} suggestions`);
      if (suggestions.length > 0) {
        console.log(`   First suggestion: ${JSON.stringify(suggestions[0], null, 2).substring(0, 200)}...`);
      }
    } else if (result.statusCode === 401 || result.statusCode === 402) {
      console.error('❌ AUTHENTICATION FAILED!');
      console.error(`   Status: ${result.statusCode}`);
      console.error(`   Response: ${JSON.stringify(result.data, null, 2)}`);
      console.error('');
      console.error('This means your credentials are incorrect or invalid.');
      console.error('Please check:');
      console.error('  1. Credentials are correct in .env file');
      console.error('  2. You\'re using the right type (Secret Key vs Public Key)');
      console.error('  3. Account is active and has credits');
      console.error('  4. Get new credentials from: https://smarty.com/account/keys');
      process.exit(1);
    } else if (result.statusCode === 429) {
      console.error('❌ RATE LIMIT EXCEEDED!');
      console.error('   Too many requests. Please wait and try again.');
      process.exit(1);
    } else {
      console.error(`❌ ERROR: Unexpected status code ${result.statusCode}`);
      console.error(`   Response: ${JSON.stringify(result.data, null, 2)}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ CONNECTION FAILED!');
    console.error(`   Error: ${err.message}`);
    console.error('');
    console.error('This could mean:');
    console.error('  1. No internet connection');
    console.error('  2. Firewall blocking the request');
    console.error('  3. Smarty API is down');
    process.exit(1);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('✅ All tests passed! Your credentials are working.');
  console.log('='.repeat(60));
}

testCredentials().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
