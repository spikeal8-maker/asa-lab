import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import credentialConfiguration from '../../apps/api/src/credential-configuration.cjs';

const SETTINGS = [
  'NODE_ENV',
  'APP_DATABASE_URL',
  'DATABASE_URL',
  'APP_TEST_DATABASE_URL',
  'CLASSROOM_CODE_SECRET',
  'ASA_STUDENT_CODE_PROTECTION_MODE',
  'ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON',
  'ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID',
  'ASA_STUDENT_CODE_LOOKUP_KEYS_JSON',
  'ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID',
];

/** Validate the effective API container environment, after Compose interpolation. */
export function validateComposeCredentials(configuration) {
  const environment = configuration?.services?.api?.environment;
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('Credential preflight requires a resolved API environment.');
  }
  const selected = {};
  for (const name of SETTINGS) {
    const value = environment[name];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new Error('Credential preflight requires string environment values.');
    }
    selected[name] = value ?? undefined;
  }
  if (!['production', 'development', 'test'].includes(selected.NODE_ENV)) {
    throw new Error('Credential preflight requires an explicit API NODE_ENV.');
  }
  credentialConfiguration.validateCredentialConfiguration(selected);
}

/**
 * Read-only Compose resolution. Capture both output streams: Docker's diagnostics
 * can contain interpolated values and must never become updater logs.
 * The updater passes its existing file selection; no shell evaluation is used.
 */
export function checkComposeCredentials(composeArguments, run = spawnSync) {
  if (
    !Array.isArray(composeArguments) ||
    composeArguments[0] !== 'compose' ||
    composeArguments.length < 3 ||
    composeArguments.length % 2 !== 1 ||
    composeArguments
      .slice(1)
      .some((value, index) =>
        index % 2 === 0 ? value !== '-f' : typeof value !== 'string' || value.length === 0,
      )
  ) {
    throw new Error('Credential preflight requires the updater Compose file selection.');
  }
  let result;
  try {
    result = run('docker', [...composeArguments, 'config', '--format', 'json'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Credential preflight could not resolve Compose configuration.');
  }
  if (result.error || result.status !== 0) {
    throw new Error('Credential preflight could not resolve Compose configuration.');
  }
  let configuration;
  try {
    configuration = JSON.parse(result.stdout);
  } catch {
    throw new Error('Credential preflight received invalid Compose configuration.');
  }
  validateComposeCredentials(configuration);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    checkComposeCredentials(process.argv.slice(2));
    process.stdout.write('CREDENTIAL CONFIG OK\n');
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Credential configuration is invalid.'}\n`,
    );
    process.exitCode = 78;
  }
}
