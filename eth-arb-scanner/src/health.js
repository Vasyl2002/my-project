import { readFileSync } from 'node:fs';
import { join } from 'node:path';
try {
  const h = JSON.parse(readFileSync(join(process.env.DATA_DIR || './data', 'health.json'), 'utf8'));
  if (Date.now() - h.at > 180000 || Date.now() - h.lastScan > 300000) process.exit(1);
} catch {
  process.exit(1);
}
