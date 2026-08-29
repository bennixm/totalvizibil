/* eslint-disable */
// Recreates .env from .env.example when it's missing. The repo lives in a
// OneDrive-synced folder where the gitignored .env occasionally disappears;
// this keeps `npm run start:dev` / prisma commands working without manual setup.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const env = path.join(root, '.env');
const example = path.join(root, '.env.example');

if (fs.existsSync(env)) process.exit(0);

if (!fs.existsSync(example)) {
  console.warn('[ensure-env] no .env and no .env.example — skipping');
  process.exit(0);
}

fs.copyFileSync(example, env);
console.warn('[ensure-env] .env was missing — created it from .env.example');
