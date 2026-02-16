import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const kycDir = path.resolve(__dirname, 'uploads', 'kyc');
console.log('Testing mkdir on:', kycDir);

try {
    if (!fs.existsSync(kycDir)) {
        fs.mkdirSync(kycDir, { recursive: true });
        console.log('mkdir success');
    } else {
        console.log('dir exists');
    }
    fs.accessSync(kycDir, fs.constants.W_OK);
    console.log('dir writable');
} catch (err) {
    console.error('Error:', err);
}
