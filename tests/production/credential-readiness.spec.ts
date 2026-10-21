import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  checkComposeCredentials,
  validateComposeCredentials,
} from '../../tools/deployment/credential-preflight.mjs';

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    APP_DATABASE_URL: 'postgres://runtime:isolated-db-password@postgres/asa_test',
    CLASSROOM_CODE_SECRET: 'isolated-class-code-secret-0123456789',
    ASA_STUDENT_CODE_PROTECTION_MODE: 'compat',
    ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON: JSON.stringify({
      enc: Buffer.alloc(32, 0x11).toString('base64'),
    }),
    ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID: 'enc',
    ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: JSON.stringify({
      lookup: Buffer.alloc(32, 0x22).toString('base64'),
    }),
    ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID: 'lookup',
    ...overrides,
  };
}

function configuration(overrides: Record<string, string | undefined> = {}) {
  return { services: { api: { environment: environment(overrides) } } };
}

describe('production credential preflight', () => {
  it.each(['decoded', 'serialized'])(
    'rejects a resolved Class Code secret copied from the %s database password',
    (representation) => {
      const password = 'synthetic%database-password-0123456789';
      const database = new URL(`postgres://runtime:${encodeURIComponent(password)}@db/asa_test`);
      const run = vi.fn(() => ({
        status: 0,
        stderr: '',
        stdout: JSON.stringify(
          configuration({
            APP_DATABASE_URL: database.href,
            CLASSROOM_CODE_SECRET: representation === 'decoded' ? password : database.password,
          }),
        ),
      }));
      expect(() => checkComposeCredentials(['compose', '-f', 'compose.yaml'], run)).toThrow(
        'CLASSROOM_CODE_SECRET must be independent from database credentials',
      );
    },
  );

  it('resolves precisely the updater Compose selection without evaluating a shell or exposing output', () => {
    const run = vi.fn(() => ({ status: 0, stdout: JSON.stringify(configuration()), stderr: '' }));
    const files = [
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose.production.yaml',
      '-f',
      'private directory/compose.frp.yaml',
    ];
    expect(() => checkComposeCredentials(files, run)).not.toThrow();
    expect(run).toHaveBeenCalledExactlyOnceWith(
      'docker',
      [...files, 'config', '--format', 'json'],
      {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  });

  it.each([
    { status: 1, stdout: JSON.stringify(configuration()), stderr: 'PRIVATE_COMPOSE_SECRET' },
    {
      status: null,
      stdout: '',
      stderr: 'PRIVATE_COMPOSE_SECRET',
      error: new Error('PRIVATE_COMPOSE_SECRET'),
    },
    { status: 0, stdout: 'PRIVATE_INVALID_JSON_SECRET', stderr: '' },
  ])('fails closed on renderer errors without printing its secret-bearing streams', (result) => {
    let failure: unknown;
    try {
      checkComposeCredentials(['compose', '-f', 'compose.yaml'], () => result);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain('PRIVATE_');
  });

  it('rejects a process exception without leaking native diagnostic text', () => {
    expect(() =>
      checkComposeCredentials(['compose', '-f', 'compose.yaml'], () => {
        throw new Error('PRIVATE_PROCESS_SECRET');
      }),
    ).toThrow('Credential preflight could not resolve Compose configuration.');
  });

  it.each([
    { arguments_: [] },
    { arguments_: ['compose'] },
    { arguments_: ['compose', 'up', '-d'] },
    { arguments_: ['compose', '-f'] },
    { arguments_: ['compose', '--env-file', 'secret.env'] },
  ])('cannot invoke a mutation or an incomplete file selection: $arguments_', ({ arguments_ }) => {
    const run = vi.fn();
    expect(() => checkComposeCredentials(arguments_, run)).toThrow(/file selection/);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { services: {} },
    { services: { api: { environment: [] } } },
    configuration({ NODE_ENV: undefined }),
    configuration({ NODE_ENV: 'unexpected' }),
    configuration({ CLASSROOM_CODE_SECRET: undefined }),
    configuration({ ASA_STUDENT_CODE_PROTECTION_MODE: 'off' }),
    configuration({ ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: '{}' }),
  ])('blocks missing or invalid effective production configuration', (value) => {
    expect(() => validateComposeCredentials(value)).toThrow();
  });

  it('validates resolved Unicode bytes and preserves explicit isolated local configuration', () => {
    expect(() =>
      validateComposeCredentials(configuration({ CLASSROOM_CODE_SECRET: '🔐'.repeat(8) })),
    ).not.toThrow();
    expect(() =>
      validateComposeCredentials({
        services: {
          api: {
            environment: {
              NODE_ENV: 'development',
              ASA_STUDENT_CODE_PROTECTION_MODE: 'off',
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it('wires each private credential variable only into the API and enforces production semantics in both production profiles', () => {
    const compose = parse(readFileSync('compose.yaml', 'utf8'));
    const names = Object.keys(environment()).filter(
      (name) => !['NODE_ENV', 'APP_DATABASE_URL'].includes(name),
    );
    for (const name of names) {
      expect(compose.services.api.environment[name]).toBe(
        `\${${name}:-${name === 'ASA_STUDENT_CODE_PROTECTION_MODE' ? 'off' : ''}}`,
      );
      for (const [service, definition] of Object.entries(compose.services)) {
        if (service !== 'api')
          expect(
            (definition as { environment?: Record<string, unknown> }).environment ?? {},
          ).not.toHaveProperty(name);
      }
    }
    for (const profile of ['production', 'staging']) {
      const overlay = parse(readFileSync(`compose.${profile}.yaml`, 'utf8'));
      expect(overlay.services.api.environment.NODE_ENV).toBe('production');
    }
  });

  it('places Linux and Windows credential checks before backup and keeps helper changes in the bootstrap fence', () => {
    const sh = readFileSync('tools/docker-update.sh', 'utf8');
    const ps = readFileSync('tools/docker-update.ps1', 'utf8');
    const shCheck = sh.indexOf('\n  assert_credential_configuration\n');
    const psCheck = ps.indexOf('  Invoke-Native node @credentialArguments');
    expect(shCheck).toBeGreaterThan(0);
    expect(psCheck).toBeGreaterThan(0);
    expect(shCheck).toBeLessThan(sh.indexOf('  backup_database "$backup_path"'));
    expect(psCheck).toBeLessThan(ps.indexOf('  $backupSha256 = New-DatabaseBackup $backupPath'));
    for (const source of [sh, ps]) {
      const bootstrap = source
        .split(/\r?\n/)
        .find((line) => /(?:bootstrap_changed|\$bootstrapChanged)\s*=/.test(line))!;
      expect(bootstrap).toContain('apps/api/src/credential-configuration.cjs');
      expect(bootstrap).toContain('tools/deployment/credential-preflight.mjs');
    }
  });

  it.each([
    { CLASSROOM_CODE_SECRET: 'short' },
    { ASA_STUDENT_CODE_PROTECTION_MODE: 'off' },
    { ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID: 'missing' },
  ])(
    'refuses the production launcher before artifact/DB work even if the calling shell is development',
    (overrides) => {
      const directory = mkdtempSync(join(tmpdir(), 'asa-credential-launch-refusal-'));
      try {
        const result = spawnSync(process.execPath, [resolve('tools/production.mjs')], {
          cwd: directory,
          env: environment({ ...overrides, NODE_ENV: 'development' }),
          encoding: 'utf8',
          timeout: 3000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(78);
        expect(result.stderr).toMatch(/CLASSROOM_CODE_SECRET|ASA_STUDENT_CODE/);
        expect(result.stderr).not.toContain('Production artifacts are missing');
        expect(result.stderr).not.toContain('isolated-class-code-secret-0123456789');
        expect(result.stdout).toBe('');
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
