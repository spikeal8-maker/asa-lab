import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyReply } from 'fastify';
import {
  ClassroomCodeSecretConfigError,
  StudentCodeProtectionConfigError,
  validateCredentialConfiguration,
} from './credential-configuration.cjs';
import {
  StudentCodeProtectionConfigError as ExportedStudentConfigError,
  StudentCodeProtectionUnavailableError,
  decryptStudentCode,
  loadStudentCodeProtectionConfig,
  protectStudentCode,
} from './student-code-protection.js';
import { HealthController } from './health.controller.js';
import { startApi } from './main.js';
import { launchApiRuntime } from './runtime.js';

vi.mock('./runtime.js', () => ({
  launchApiRuntime: vi.fn(async () => ({ stop: vi.fn(async () => undefined) })),
}));

const encryption = Buffer.alloc(32, 0x61);
const lookup = Buffer.alloc(32, 0x62);
const retiring = Buffer.alloc(32, 0x63);
const classSecret = 'isolated-classroom-code-secret-0123456789';

function configured(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    APP_DATABASE_URL: 'postgres://runtime:isolated-db-password@postgres/asa_test',
    CLASSROOM_CODE_SECRET: classSecret,
    ASA_STUDENT_CODE_PROTECTION_MODE: 'compat',
    ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON: JSON.stringify({
      current: encryption.toString('base64'),
    }),
    ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID: 'current',
    ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: JSON.stringify({
      current: lookup.toString('base64'),
      retired: retiring.toString('base64'),
    }),
    ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID: 'current',
    ...overrides,
  };
}

function useEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  vi.stubEnv('DATABASE_URL', undefined);
  vi.stubEnv('APP_TEST_DATABASE_URL', undefined);
}

function pool(): pg.Pool {
  return { query: vi.fn(async () => ({ rows: [{ version: 225 }] })) } as unknown as pg.Pool;
}

function reply(): FastifyReply {
  return { code: vi.fn() } as unknown as FastifyReply;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('one credential configuration authority', () => {
  it.each(['compat', 'enforced'])(
    'accepts complete independent production material in %s mode',
    (mode) => {
      expect(() =>
        validateCredentialConfiguration(configured({ ASA_STUDENT_CODE_PROTECTION_MODE: mode })),
      ).not.toThrow();
    },
  );

  it('preserves the public error class identity for existing controller instanceof checks', () => {
    const commonJs = createRequire(import.meta.url)('./credential-configuration.cjs');
    expect(ExportedStudentConfigError).toBe(StudentCodeProtectionConfigError);
    // Vitest transforms source imports in a separate loader cache; exercise
    // native CommonJS against its own exported constructor as well.
    expect(() =>
      commonJs.loadStudentCodeProtectionConfig(
        configured({ ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: '{}' }),
      ),
    ).toThrow(commonJs.StudentCodeProtectionConfigError);
    try {
      loadStudentCodeProtectionConfig(configured({ ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: '{}' }));
      expect.fail('missing active key must fail closed');
    } catch (error) {
      expect(error).toBeInstanceOf(ExportedStudentConfigError);
    }
  });

  it.each([
    { ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON: undefined },
    { ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID: undefined },
    { ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID: 'missing' },
    { ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON: '{private-invalid-json' },
    { ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: '[]' },
    { ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON: JSON.stringify({ current: 'AA==' }) },
    { ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: JSON.stringify({ current: 'AA==' }) },
    {
      ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: JSON.stringify({ current: encryption.toString('base64') }),
    },
    {
      ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON: JSON.stringify({
        current: encryption.toString('base64'),
        retired: 'invalid!',
      }),
    },
  ])(
    'rejects incomplete, malformed or shared global key material without disclosure: %j',
    (overrides) => {
      const environment = configured(overrides);
      let failure: unknown;
      try {
        validateCredentialConfiguration(environment);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(StudentCodeProtectionConfigError);
      const message = String(failure);
      expect(message).not.toContain(classSecret);
      expect(message).not.toContain(encryption.toString('base64'));
      expect(message).not.toContain(lookup.toString('base64'));
      expect(message).not.toContain('private-invalid-json');
      expect(message).not.toContain('isolated-db-password');
    },
  );

  it.each([
    encryption.toString('utf8'),
    encryption.toString('base64'),
    encryption.toString('base64').replace(/=+$/, ''),
    encryption.toString('base64url'),
    encryption.toString('hex'),
    encryption.toString('hex').toUpperCase(),
    retiring.toString('base64'),
  ])(
    'rejects a Class Code secret reused from an active or retiring Student Code key: %j',
    (secret) => {
      expect(() =>
        validateCredentialConfiguration(configured({ CLASSROOM_CODE_SECRET: secret })),
      ).toThrow(ClassroomCodeSecretConfigError);
    },
  );
});

describe('credential startup and readiness boundary', () => {
  it.each([
    { CLASSROOM_CODE_SECRET: undefined },
    { CLASSROOM_CODE_SECRET: 'short' },
    { ASA_STUDENT_CODE_PROTECTION_MODE: 'off' },
    { ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID: 'missing' },
  ])(
    'refuses the HTTP/runtime launch before creating a pool for invalid production material: %j',
    async (overrides) => {
      useEnvironment(configured(overrides));
      await expect(startApi()).rejects.toThrow();
      expect(launchApiRuntime).not.toHaveBeenCalled();
    },
  );

  it('starts the existing runtime only after complete configuration has passed', async () => {
    useEnvironment(configured());
    const runtime = await startApi();
    expect(launchApiRuntime).toHaveBeenCalledOnce();
    await runtime.close();
    const started = await vi.mocked(launchApiRuntime).mock.results[0]?.value;
    expect(started?.stop).toHaveBeenCalledOnce();
  });

  it('reports a sanitized global configuration failure without exposing values or key identifiers', async () => {
    useEnvironment(
      configured({ ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID: 'missing-private-key-id' }),
    );
    const response = reply();
    const body = await new HealthController(pool(), null).ready(response);
    expect(response.code).toHaveBeenCalledWith(503);
    expect(body).toMatchObject({
      status: 'not_ready',
      dependencies: { database: 'up', credentialConfiguration: 'invalid' },
    });
    const serialized = JSON.stringify(body);
    for (const secret of [
      classSecret,
      encryption.toString('base64'),
      'missing-private-key-id',
      'isolated-db-password',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('keeps global readiness available after an unknown historical row key fails only that credential operation', async () => {
    useEnvironment(configured());
    const config = loadStudentCodeProtectionConfig()!;
    const identity = {
      tenantId: 'tenant-a',
      classroomId: 'class-a',
      seatId: 'seat-a',
      credentialVersion: 7,
    };
    const envelope = protectStudentCode(config, { ...identity, studentCode: 'Ab7k' });
    expect(() =>
      decryptStudentCode(config, {
        ...identity,
        ...envelope,
        encryptionKeyId: 'unknown-historical-key',
      }),
    ).toThrow(StudentCodeProtectionUnavailableError);
    const database = pool();
    const response = reply();
    const body = await new HealthController(database, null).ready(response);
    expect(response.code).toHaveBeenCalledWith(200);
    expect(body).toMatchObject({
      status: 'ready',
      dependencies: { database: 'up', credentialConfiguration: 'valid' },
    });
    expect(database.query).toHaveBeenCalledExactlyOnceWith(
      'SELECT version FROM runtime_schema_version()',
    );
    expect(JSON.stringify(body)).not.toContain('unknown-historical-key');
  });

  it('matches the closed OpenAPI readiness contract for actual ready and unavailable bodies', async () => {
    const document = parse(readFileSync('schemas/openapi.yaml', 'utf8')) as { components: unknown };
    const validate = new Ajv2020({ strict: false, allErrors: true }).compile({
      $ref: '#/components/schemas/ReadyResponse',
      components: document.components,
    });
    useEnvironment(configured());
    const ready = await new HealthController(pool(), null).ready(reply());
    expect(validate(ready), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...ready, dependencies: { ...ready.dependencies, database: 'busy' } })).toBe(
      true,
    );
    vi.stubEnv('CLASSROOM_CODE_SECRET', undefined);
    const unavailable = await new HealthController(pool(), null).ready(reply());
    expect(validate(unavailable), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...ready, secrets: configured() })).toBe(false);
    expect(validate({ ...ready, dependencies: { database: 'up' } })).toBe(false);
  });
});
