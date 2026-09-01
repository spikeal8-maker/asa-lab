#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

const marker = '--env-file';
const markerIndex = process.argv.indexOf(marker);
const input = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined;
if (!input || !isAbsolute(input)) {
  console.error('Usage: provision-settings-key.mjs --env-file <absolute .env.local path>');
  process.exit(64);
}

const target = resolve(input);
if (basename(target) !== '.env.local' || !existsSync(target) || !statSync(target).isFile()) {
  console.error('The target must be an existing file named .env.local.');
  process.exit(64);
}

const source = readFileSync(target, 'utf8');
const matches = [...source.matchAll(/^\s*ASA_SETTINGS_ENCRYPTION_KEY\s*=\s*(.*?)\s*$/gm)];
if (matches.length > 1) {
  console.error('ASA_SETTINGS_ENCRYPTION_KEY is duplicated; refusing to choose one.');
  process.exit(65);
}
if (matches.length === 1) {
  const value = matches[0]?.[1]?.replace(/^['"]|['"]$/g, '') ?? '';
  const valid =
    /^[a-fA-F0-9]{64}$/.test(value) ||
    (/^[A-Za-z0-9_-]{43}$/.test(value) && Buffer.from(value, 'base64url').length === 32);
  if (!valid) {
    console.error('Existing ASA_SETTINGS_ENCRYPTION_KEY is invalid; no file changes were made.');
    process.exit(65);
  }
  console.log('ASA settings encryption key is already provisioned.');
  process.exit(0);
}

const separator = source.length === 0 || source.endsWith('\n') ? '' : '\n';
appendFileSync(
  target,
  `${separator}# Runtime integration-secret encryption; never commit.\nASA_SETTINGS_ENCRYPTION_KEY=${randomBytes(32).toString('base64url')}\n`,
  { encoding: 'utf8', mode: 0o600 },
);
console.log('ASA settings encryption key was generated without printing its value.');
