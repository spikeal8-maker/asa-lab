import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classroomCodeSecret } from './classroom-code-secret.js';
import { loadStudentCodeProtectionConfig } from './student-code-protection.js';

const explicit = 'test-only-class-code-secret-0123456789';
const databaseSettings = ['APP_DATABASE_URL', 'DATABASE_URL', 'APP_TEST_DATABASE_URL'] as const;
const databasePassword = 'synthetic%database-password-0123456789';
const encodedDatabase = new URL(
  `postgres://runtime:${encodeURIComponent(databasePassword)}@postgres/asa_test`,
);

function useDatabase(name: (typeof databaseSettings)[number], url: string, mode: string): void {
  vi.stubEnv('NODE_ENV', mode);
  for (const setting of databaseSettings) vi.stubEnv(setting, undefined);
  vi.stubEnv(name, url);
}

afterEach(() => vi.unstubAllEnvs());

describe('production classroom credential secret boundary', () => {
  it.each([undefined, '', 'too-short', ' '.repeat(40)])(
    'refuses a missing or invalid production Class Code secret without a DB fallback: %j',
    (secret) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('CLASSROOM_CODE_SECRET', secret);
      vi.stubEnv('APP_DATABASE_URL', 'postgres://runtime:private-db-password@postgres/asa');
      expect(() => classroomCodeSecret()).toThrow(/CLASSROOM_CODE_SECRET/);
    },
  );

  it('preserves the exact existing explicit-secret derivation across DB password and host changes', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CLASSROOM_CODE_SECRET', explicit);
    vi.stubEnv('APP_DATABASE_URL', 'postgres://runtime:old-password@postgres/asa');
    const expected = createHash('sha256').update(`classroom-code:${explicit}`).digest('hex');
    expect(classroomCodeSecret()).toBe(expected);
    vi.stubEnv('APP_DATABASE_URL', 'postgres://runtime:new-password@replacement-host/asa');
    expect(classroomCodeSecret()).toBe(expected);
  });

  it('measures the explicit material in UTF-8 bytes without trimming or transforming it', () => {
    const unicodeSecret = '🔐'.repeat(8);
    expect(Buffer.byteLength(unicodeSecret, 'utf8')).toBe(32);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CLASSROOM_CODE_SECRET', unicodeSecret);
    vi.stubEnv('APP_DATABASE_URL', 'postgres://runtime:unrelated-password@postgres/asa');
    expect(classroomCodeSecret()).toBe(
      createHash('sha256').update(`classroom-code:${unicodeSecret}`).digest('hex'),
    );
  });

  it('rejects a production secret copied from the database password', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CLASSROOM_CODE_SECRET', explicit);
    vi.stubEnv(
      'APP_DATABASE_URL',
      `postgres://runtime:${encodeURIComponent(explicit)}@postgres/asa`,
    );
    expect(() => classroomCodeSecret()).toThrow(/independent/);
  });

  it('preserves isolated local and test fallback behavior', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CLASSROOM_CODE_SECRET', undefined);
    vi.stubEnv('APP_DATABASE_URL', 'postgres://runtime:isolated-secret@postgres/asa_test');
    expect(classroomCodeSecret()).toBe(
      createHash('sha256').update('classroom-code:isolated-secret').digest('hex'),
    );
    vi.stubEnv('CLASSROOM_CODE_SECRET', 'isolated-explicit');
    expect(classroomCodeSecret()).toBe(
      createHash('sha256').update('classroom-code:isolated-explicit').digest('hex'),
    );
  });

  it.each([undefined, '', 'off'])(
    'rejects disabled Student Code protection in production: %j',
    (mode) => {
      expect(() =>
        loadStudentCodeProtectionConfig({
          NODE_ENV: 'production',
          ASA_STUDENT_CODE_PROTECTION_MODE: mode,
        }),
      ).toThrow(/ASA_STUDENT_CODE_PROTECTION_MODE/);
    },
  );
});

describe.each(databaseSettings)('database credential independence for %s', (setting) => {
  it.each([
    { label: 'decoded password', url: encodedDatabase.href, secret: databasePassword },
    {
      label: 'URL-serialized password',
      url: encodedDatabase.href,
      secret: encodedDatabase.password,
    },
    { label: 'full database URL', url: encodedDatabase.href, secret: encodedDatabase.href },
    {
      label: 'URL password with an undecodable percent character',
      url: `postgres://runtime:${databasePassword}@postgres/asa_test`,
      secret: databasePassword,
    },
  ])('rejects copied $label without disclosing its bytes', ({ url, secret }) => {
    useDatabase(setting, url, 'production');
    vi.stubEnv('CLASSROOM_CODE_SECRET', secret);
    let failure: unknown;
    try {
      classroomCodeSecret();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain('must be independent from database credentials');
    expect(String(failure)).not.toContain(secret);
  });

  it('keeps independent explicit bytes stable across encoded database password changes', () => {
    useDatabase(setting, encodedDatabase.href, 'production');
    const independent = ` ${explicit}%🔐 `;
    vi.stubEnv('CLASSROOM_CODE_SECRET', independent);
    const expected = createHash('sha256').update(`classroom-code:${independent}`).digest('hex');
    expect(classroomCodeSecret()).toBe(expected);
    vi.stubEnv(setting, 'postgres://runtime:replacement%25password@replacement/asa_test');
    expect(classroomCodeSecret()).toBe(expected);
  });

  it.each(['development', 'test'])('preserves the %s URL-password fallback bytes', (mode) => {
    useDatabase(setting, encodedDatabase.href, mode);
    vi.stubEnv('CLASSROOM_CODE_SECRET', undefined);
    expect(classroomCodeSecret()).toBe(
      createHash('sha256').update(`classroom-code:${encodedDatabase.password}`).digest('hex'),
    );
    vi.stubEnv(setting, `postgres://runtime:${databasePassword}@postgres/asa_test`);
    expect(classroomCodeSecret()).toBe(
      createHash('sha256').update(`classroom-code:${databasePassword}`).digest('hex'),
    );
  });
});
