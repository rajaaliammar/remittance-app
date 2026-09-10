/**
 * Runs Prisma CLI after env-bootstrap (sets DIRECT_DATABASE_URL fallback).
 * Usage: node scripts/prisma-env.js migrate dev
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Windows path ko valid file:// URL mein convert kar ke import kar rahe hain
const bootstrapPath = path.join(__dirname, '../src/env-bootstrap.js');
await import(pathToFileURL(bootstrapPath).href);

const args = process.argv.slice(2);
const result = spawnSync('npx', ['prisma@6', ...args], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);