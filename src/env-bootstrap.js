/**
 * Must be imported first from server.js. ES modules evaluate imports before
 * server.js body runs, so dotenv.config() after imports never ran before
 * modules that read process.env at load time (e.g. acceptblue.service.js).
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

/** Prefer backend/.env; then cwd (when npm run is invoked from repo root, cwd may differ). */
function loadEnvFiles() {
  const candidates = [
    path.join(packageRoot, '.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      dotenv.config({ path: filePath });
    }
  }
}

loadEnvFiles();

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    '\n❌ DATABASE_URL is not set.\n' +
      '   Add it to Remittance_backend/.env (copy from .env.example):\n' +
      `   DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/remittance_db?schema=public"\n` +
      `   Tried: ${path.join(packageRoot, '.env')} and ${path.join(process.cwd(), '.env')}\n`,
  );
  process.exit(1);
}
