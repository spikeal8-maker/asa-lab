import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classroomCodeSecret } from './classroom-code-secret.js';
import { loadStudentCodeProtectionConfig } from './student-code-protection.js';

const explicit = 'test-only-class-code-secret-0123456789';

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
