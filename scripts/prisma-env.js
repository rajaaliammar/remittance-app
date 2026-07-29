/**
 * Runs Prisma CLI after env-bootstrap (sets DIRECT_DATABASE_URL fallback).
 * Usage: node scripts/prisma-env.js migrate dev
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(__dirname, '../src/env-bootstrap.js'));

const args = process.argv.slice(2);
const result = spawnSync('npx', ['prisma@6', ...args], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
