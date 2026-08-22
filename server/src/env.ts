import path from 'path';
import fs from 'fs';

const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    let raw = fs.readFileSync(envPath, 'utf-8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const val = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
    console.log(`[J.A.R.V.I.S.] Loaded .env from: ${envPath}`);
    break;
  }
}

if (process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY.trim();
  console.log(`[J.A.R.V.I.S.] API key loaded (${process.env.ANTHROPIC_API_KEY.substring(0, 10)}...)`);
} else {
  console.error('[J.A.R.V.I.S.] WARNING: ANTHROPIC_API_KEY not found!');
}
