import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export type StudentCodeProtectionMode = 'off' | 'compat' | 'enforced';

export interface StudentCodeLookupCandidate {
  keyId: string;
  digest: string;
}

interface LoadedKeyring {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

export interface StudentCodeProtectionConfig {
  mode: Exclude<StudentCodeProtectionMode, 'off'>;
  encryption: LoadedKeyring;
  lookup: LoadedKeyring;
}

export interface ProtectedStudentCodeEnvelope {
  encryptionKeyId: string;
  encryptionNonce: Buffer;
  encryptionCiphertext: Buffer;
  encryptionTag: Buffer;
  lookupKeyId: string;
  lookupDigest: string;
  lookupCandidates: StudentCodeLookupCandidate[];
}

export interface StoredProtectedStudentCode {
  tenantId: string;
  classroomId: string;
  seatId: string;
  credentialVersion: number;
  encryptionKeyId: string;
  encryptionNonce: Buffer;
  encryptionCiphertext: Buffer;
  encryptionTag: Buffer;
}

export class StudentCodeProtectionUnavailableError extends Error {
  constructor(message = 'Student Code protected storage is unavailable') {
    super(message);
    this.name = 'StudentCodeProtectionUnavailableError';
  }
}

export {
  loadStudentCodeProtectionConfig,
  StudentCodeProtectionConfigError,
} from './credential-configuration.cjs';

const STUDENT_CODE_PATTERN = /^[A-Za-z0-9]{4,10}$/;

export function studentCodeAad(
  tenantId: string,
  classroomId: string,
  seatId: string,
  credentialVersion: number,
): Buffer {
  if (!Number.isInteger(credentialVersion) || credentialVersion <= 0) {
    throw new StudentCodeProtectionUnavailableError('invalid credential version');
  }
  return Buffer.from(`v1|${tenantId}|${classroomId}|${seatId}|${credentialVersion}`, 'utf8');
}

function normalizeStudentCode(studentCode: string): string {
  const normalized = studentCode.trim();
  if (!STUDENT_CODE_PATTERN.test(normalized)) {
    throw new StudentCodeProtectionUnavailableError('invalid Student Code');
  }
  return normalized;
}

export function studentCodeLookupCandidates(
  config: StudentCodeProtectionConfig,
  tenantId: string,
  classroomId: string,
  studentCode: string,
): StudentCodeLookupCandidate[] {
  const normalized = normalizeStudentCode(studentCode);
  const payload = `v1|${tenantId}|${classroomId}|${normalized}`;
  const ordered = [...config.lookup.keys.entries()].sort(([left], [right]) => {
    if (left === config.lookup.activeKeyId) return -1;
    if (right === config.lookup.activeKeyId) return 1;
    return left.localeCompare(right);
  });
  return ordered.map(([keyId, key]) => ({
    keyId,
    digest: createHmac('sha256', key).update(payload, 'utf8').digest('hex'),
  }));
}

export function protectStudentCode(
  config: StudentCodeProtectionConfig,
  input: {
    tenantId: string;
    classroomId: string;
    seatId: string;
    credentialVersion: number;
    studentCode: string;
  },
): ProtectedStudentCodeEnvelope {
  const normalized = normalizeStudentCode(input.studentCode);
  const encryptionKey = config.encryption.keys.get(config.encryption.activeKeyId);
  if (!encryptionKey) throw new StudentCodeProtectionUnavailableError();

  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
  cipher.setAAD(
    studentCodeAad(input.tenantId, input.classroomId, input.seatId, input.credentialVersion),
  );
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const lookupCandidates = studentCodeLookupCandidates(
    config,
    input.tenantId,
    input.classroomId,
    normalized,
  );
  const activeLookup = lookupCandidates.find(
    (candidate) => candidate.keyId === config.lookup.activeKeyId,
  );
  if (!activeLookup) throw new StudentCodeProtectionUnavailableError();

  return {
    encryptionKeyId: config.encryption.activeKeyId,
    encryptionNonce: nonce,
    encryptionCiphertext: ciphertext,
    encryptionTag: tag,
    lookupKeyId: activeLookup.keyId,
    lookupDigest: activeLookup.digest,
    lookupCandidates,
  };
}

export function decryptStudentCode(
  config: StudentCodeProtectionConfig,
  stored: StoredProtectedStudentCode,
): string {
  const key = config.encryption.keys.get(stored.encryptionKeyId);
  if (!key) {
    throw new StudentCodeProtectionUnavailableError('unknown Student Code encryption key ID');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, stored.encryptionNonce);
    decipher.setAAD(
      studentCodeAad(stored.tenantId, stored.classroomId, stored.seatId, stored.credentialVersion),
    );
    decipher.setAuthTag(stored.encryptionTag);
    const plaintext = Buffer.concat([
      decipher.update(stored.encryptionCiphertext),
      decipher.final(),
    ]).toString('utf8');
    return normalizeStudentCode(plaintext);
  } catch {
    throw new StudentCodeProtectionUnavailableError('Student Code envelope authentication failed');
  }
}
