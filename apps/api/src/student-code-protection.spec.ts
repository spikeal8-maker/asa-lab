import { describe, expect, it } from 'vitest';
import {
  decryptStudentCode,
  loadStudentCodeProtectionConfig,
  protectStudentCode,
  StudentCodeProtectionConfigError,
  StudentCodeProtectionUnavailableError,
  studentCodeLookupCandidates,
} from './student-code-protection.js';

const encryptionKey = Buffer.alloc(32, 0x11).toString('base64');
const lookupKey = Buffer.alloc(32, 0x22).toString('base64');
const retiringLookupKey = Buffer.alloc(32, 0x33).toString('base64');

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ASA_STUDENT_CODE_PROTECTION_MODE: 'compat',
    ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON: JSON.stringify({ enc1: encryptionKey }),
    ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID: 'enc1',
    ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: JSON.stringify({
      look1: lookupKey,
      look0: retiringLookupKey,
    }),
    ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID: 'look1',
    ...overrides,
  };
}

describe('Student Code protection keyring', () => {
  it('encrypts with AES-256-GCM and decrypts only with the exact AAD context', () => {
    const config = loadStudentCodeProtectionConfig(env())!;
    const protectedCode = protectStudentCode(config, {
      tenantId: 'tenant-a',
      classroomId: 'class-a',
      seatId: 'seat-a',
      credentialVersion: 7,
      studentCode: ' Ab7k ',
    });

    expect(protectedCode.encryptionNonce).toHaveLength(12);
    expect(protectedCode.encryptionTag).toHaveLength(16);
    expect(protectedCode.encryptionCiphertext.toString('utf8')).not.toContain('Ab7k');
    expect(
      decryptStudentCode(config, {
        tenantId: 'tenant-a',
        classroomId: 'class-a',
        seatId: 'seat-a',
        credentialVersion: 7,
        encryptionKeyId: protectedCode.encryptionKeyId,
        encryptionNonce: protectedCode.encryptionNonce,
        encryptionCiphertext: protectedCode.encryptionCiphertext,
        encryptionTag: protectedCode.encryptionTag,
      }),
    ).toBe('Ab7k');

    expect(() =>
      decryptStudentCode(config, {
        tenantId: 'tenant-a',
        classroomId: 'class-a',
        seatId: 'seat-b',
        credentialVersion: 7,
        encryptionKeyId: protectedCode.encryptionKeyId,
        encryptionNonce: protectedCode.encryptionNonce,
        encryptionCiphertext: protectedCode.encryptionCiphertext,
        encryptionTag: protectedCode.encryptionTag,
      }),
    ).toThrow(StudentCodeProtectionUnavailableError);
  });

  it('uses case-sensitive HMAC-SHA-256 lookup candidates for active and retiring keys', () => {
    const config = loadStudentCodeProtectionConfig(env())!;
    const upper = studentCodeLookupCandidates(config, 'tenant-a', 'class-a', 'Ab7k');
    const lower = studentCodeLookupCandidates(config, 'tenant-a', 'class-a', 'ab7k');

    expect(upper).toHaveLength(2);
    expect(upper[0]?.keyId).toBe('look1');
    expect(upper.every((candidate) => /^[0-9a-f]{64}$/.test(candidate.digest))).toBe(true);
    expect(upper.map((candidate) => candidate.digest)).not.toEqual(
      lower.map((candidate) => candidate.digest),
    );
  });

  it('keeps historical encryption keys usable while a new active key protects new envelopes', () => {
    const oldConfig = loadStudentCodeProtectionConfig(env())!;
    const oldEnvelope = protectStudentCode(oldConfig, {
      tenantId: 'tenant-a',
      classroomId: 'class-a',
      seatId: 'seat-a',
      credentialVersion: 9,
      studentCode: 'Ab7k',
    });

    const enc2 = Buffer.alloc(32, 0x71).toString('base64');
    const rotatedConfig = loadStudentCodeProtectionConfig(
      env({
        ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON: JSON.stringify({
          enc2,
          enc1: encryptionKey,
        }),
        ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID: 'enc2',
      }),
    )!;

    expect(
      decryptStudentCode(rotatedConfig, {
        tenantId: 'tenant-a',
        classroomId: 'class-a',
        seatId: 'seat-a',
        credentialVersion: 9,
        encryptionKeyId: oldEnvelope.encryptionKeyId,
        encryptionNonce: oldEnvelope.encryptionNonce,
        encryptionCiphertext: oldEnvelope.encryptionCiphertext,
        encryptionTag: oldEnvelope.encryptionTag,
      }),
    ).toBe('Ab7k');

    const newEnvelope = protectStudentCode(rotatedConfig, {
      tenantId: 'tenant-a',
      classroomId: 'class-a',
      seatId: 'seat-a',
      credentialVersion: 9,
      studentCode: 'Ab7k',
    });
    expect(newEnvelope.encryptionKeyId).toBe('enc2');
  });

  it('rejects malformed, missing and shared key material while off mode needs no keyring', () => {
    expect(loadStudentCodeProtectionConfig({ ASA_STUDENT_CODE_PROTECTION_MODE: 'off' })).toBeNull();

    expect(() =>
      loadStudentCodeProtectionConfig(
        env({ ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON: JSON.stringify({ enc1: 'AA==' }) }),
      ),
    ).toThrow(StudentCodeProtectionConfigError);

    expect(() =>
      loadStudentCodeProtectionConfig(
        env({ ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID: 'missing' }),
      ),
    ).toThrow(StudentCodeProtectionConfigError);

    expect(() =>
      loadStudentCodeProtectionConfig(
        env({
          ASA_STUDENT_CODE_LOOKUP_KEYS_JSON: JSON.stringify({ look1: encryptionKey }),
        }),
      ),
    ).toThrow(StudentCodeProtectionConfigError);
  });

  it('fails closed for an unknown historical encryption key ID and tampered tag', () => {
    const config = loadStudentCodeProtectionConfig(env())!;
    const protectedCode = protectStudentCode(config, {
      tenantId: 'tenant-a',
      classroomId: 'class-a',
      seatId: 'seat-a',
      credentialVersion: 3,
      studentCode: 'QRT234',
    });
    const stored = {
      tenantId: 'tenant-a',
      classroomId: 'class-a',
      seatId: 'seat-a',
      credentialVersion: 3,
      encryptionKeyId: protectedCode.encryptionKeyId,
      encryptionNonce: protectedCode.encryptionNonce,
      encryptionCiphertext: protectedCode.encryptionCiphertext,
      encryptionTag: protectedCode.encryptionTag,
    };

    expect(() => decryptStudentCode(config, { ...stored, encryptionKeyId: 'retired-missing' })).toThrow(
      StudentCodeProtectionUnavailableError,
    );

    const tampered = Buffer.from(stored.encryptionTag);
    tampered[0] ^= 0xff;
    expect(() => decryptStudentCode(config, { ...stored, encryptionTag: tampered })).toThrow(
      StudentCodeProtectionUnavailableError,
    );
  });
});
