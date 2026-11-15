#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

const markerIndex = process.argv.indexOf('--env-file');
const input = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined;
const newStore = process.argv.includes('--new-store');
if (!input || !isAbsolute(input)) {
  console.error(
    'Usage: provision-settings-key.mjs --env-file <absolute .env.local path> [--new-store]',
  );
  process.exit(64);
}

const target = resolve(input);
if (basename(target) !== '.env.local' || !existsSync(target) || !statSync(target).isFile()) {
  console.error('The target must be an existing file named .env.local.');
  process.exit(64);
}

const source = readFileSync(target, 'utf8');
const assignments = source
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .filter((line) => /^[ \t]*(?:export[ \t]+)?ASA_SETTINGS_ENCRYPTION_KEY(?:[ \t=]|$)/.test(line));
const restoreMessage =
  'Restore the original key from the protected installation backup. Do not generate a replacement for stored integration credentials.';
if (assignments.length > 1) {
  console.error('ASA_SETTINGS_ENCRYPTION_KEY is duplicated; no file changes were made.');
  console.error(restoreMessage);
  process.exit(65);
}
if (assignments.length === 1) {
  const match = assignments[0].match(
    /^[ \t]*(?:export[ \t]+)?ASA_SETTINGS_ENCRYPTION_KEY[ \t]*=[ \t]*(.*?)[ \t]*$/,
  );
  let value = match?.[1] ?? '';
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const closing = value.indexOf(quote, 1);
    value =
      closing >= 1 && /^[ \t]*(?:#.*)?$/.test(value.slice(closing + 1))
        ? value.slice(1, closing)
        : '';
  } else {
    value = value.replace(/[ \t]+#.*$/, '').replace(/[ \t]+$/, '');
  }
  const valid =
    /^[a-fA-F0-9]{64}$/.test(value) ||
    (/^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').length === 32);
  if (!valid) {
    console.error('Existing ASA_SETTINGS_ENCRYPTION_KEY is invalid; no file changes were made.');
    console.error(restoreMessage);
    process.exit(65);
  }
  console.log('ASA settings encryption key is already provisioned.');
  process.exit(0);
}

if (!newStore) {
  console.error('ASA_SETTINGS_ENCRYPTION_KEY is missing; no file changes were made.');
  console.error(restoreMessage);
  console.error(
    'Only for a genuinely new configuration with no encrypted integration credentials, rerun with --new-store.',
  );
  process.exit(65);
}

const newline = source.includes('\r\n') ? '\r\n' : '\n';
const separator = source.length === 0 || source.endsWith('\n') ? '' : newline;
appendFileSync(
  target,
  separator +
    '# Runtime integration-secret encryption; never commit.' +
    newline +
    'ASA_SETTINGS_ENCRYPTION_KEY=' +
    randomBytes(32).toString('base64url') +
    newline,
  { encoding: 'utf8', mode: 0o600 },
);
console.log(
  'ASA settings encryption key was generated for the new store without printing its value.',
);
