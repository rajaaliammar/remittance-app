/**
 * Must be imported first from server.js. ES modules evaluate imports before
 * server.js body runs, so dotenv.config() after imports never ran before
 * modules that read process.env at load time (e.g. acceptblue.service.js).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
