// Disposable CI bootstrap, not a product migration or supported live command.
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main } from '/app/tools/migrate.mjs';

if (process.env.ASA_LEGACY_DISPOSABLE_FIXTURE !== 'true') {
  throw new Error('This bootstrap is only for the disposable legacy CI fixture');
}
const directory = mkdtempSync(join(tmpdir(), 'asa-legacy-schema-'));
mkdirSync(join(directory, 'migrations'));
const files = readdirSync('/app/migrations').filter(
  (name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 261,
);
if (!files.some((name) => name.startsWith('0261_'))) throw new Error('Missing schema 261');
for (const name of files) {
  copyFileSync(join('/app/migrations', name), join(directory, 'migrations', name));
}
process.chdir(directory);
const result = await main(['--apply']);
if (result !== 0) process.exit(result);
process.chdir('/app');
await import('/app/docker/provision-runtime-role.mjs');
await import('/app/tools/seed-dev.mjs');
