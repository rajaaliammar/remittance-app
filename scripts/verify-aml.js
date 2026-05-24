#!/usr/bin/env node
/**
 * Verify AML credentials before deploy or after .env changes.
 * Usage: npm run aml:verify
 */
import '../src/env-bootstrap.js';
import { verifyAmlConnectionAtStartup } from '../src/services/amlProvider.service.js';

const result = await verifyAmlConnectionAtStartup();
if (result.ok) {
  console.log('✅ AML login successful — credentials are valid');
  process.exit(0);
}
console.error('❌ AML login failed:', result.reason);
console.error(
  '   Check Remittance_backend/.env — use AML_PASSWORD="..." if password contains #',
);
process.exit(1);
