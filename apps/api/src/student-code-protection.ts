import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

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

export class StudentCodeProtectionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentCodeProtectionConfigError';
  }
}

export class StudentCodeProtectionUnavailableError extends Error {
  constructor(message = 'Student Code protected storage is unavailable') {
    super(message);
    this.name = 'StudentCodeProtectionUnavailableError';
  }
}

const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const STUDENT_CODE_PATTERN = /^[A-Za-z0-9]{4,10}$/;

function protectionMode(env: NodeJS.ProcessEnv): StudentCodeProtectionMode {
  const raw = env['ASA_STUDENT_CODE_PROTECTION_MODE']?.trim() || 'off';
  if (raw === 'off' || raw === 'compat' || raw === 'enforced') return raw;
  throw new StudentCodeProtectionConfigError(
    'ASA_STUDENT_CODE_PROTECTION_MODE must be off, compat, or enforced',
  );
}

function decodeBase64Key(value: unknown, label: string): Buffer {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) {
    throw new StudentCodeProtectionConfigError(`${label} must be a base64 string`);
  }
  const decoded = Buffer.from(value, 'base64');
  const canonical = decoded.toString('base64').replace(/=+$/u, '');
  if (canonical.length === 0 || canonical !== value.replace(/=+$/u, '')) {
    throw new StudentCodeProtectionConfigError(`${label} is not canonical base64`);
  }
  return decoded;
}

function loadKeyring(
  env: NodeJS.ProcessEnv,
  jsonName: string,
  activeName: string,
  exactBytes?: number,
  minimumBytes?: number,
): LoadedKeyring {
  const json = env[jsonName];
  const activeKeyId = env[activeName]?.trim();
  if (!json || !activeKeyId) {
    throw new StudentCodeProtectionConfigError(`${jsonName} and ${activeName} are required`);
  }
  if (!KEY_ID_PATTERN.test(activeKeyId)) {
    throw new StudentCodeProtectionConfigError(`${activeName} is invalid`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new StudentCodeProtectionConfigError(`${jsonName} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StudentCodeProtectionConfigError(`${jsonName} must be a JSON object`);
  }

  const keys = new Map<string, Buffer>();
  for (const [keyId, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new StudentCodeProtectionConfigError(`${jsonName} contains an invalid key ID`);
    }
    const key = decodeBase64Key(raw, `${jsonName}[${keyId}]`);
    if (exactBytes !== undefined && key.length !== exactBytes) {
      throw new StudentCodeProtectionConfigError(
        `${jsonName}[${keyId}] must decode to exactly ${exactBytes} bytes`,
      );
    }
    if (minimumBytes !== undefined && key.length < minimumBytes) {
      throw new StudentCodeProtectionConfigError(
        `${jsonName}[${keyId}] must decode to at least ${minimumBytes} bytes`,
      );
    }
    keys.set(keyId, key);
  }
  if (!keys.has(activeKeyId)) {
    throw new StudentCodeProtectionConfigError(`${activeName} is absent from ${jsonName}`);
  }
  return { activeKeyId, keys };
}

export function loadStudentCodeProtectionConfig(
  env: NodeJS.ProcessEnv = process.env,
): StudentCodeProtectionConfig | null {
  const mode = protectionMode(env);
  if (mode === 'off') return null;

  const encryption = loadKeyring(
    env,
    'ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON',
    'ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID',
    32,
  );
  const lookup = loadKeyring(
    env,
    'ASA_STUDENT_CODE_LOOKUP_KEYS_JSON',
    'ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID',
    undefined,
    32,
  );

  for (const encryptionKey of encryption.keys.values()) {
    for (const lookupKey of lookup.keys.values()) {
      if (encryptionKey.length === lookupKey.length && timingSafeEqual(encryptionKey, lookupKey)) {
        throw new StudentCodeProtectionConfigError(
          'Student Code encryption and lookup key material must be distinct',
        );
      }
    }
  }

  return { mode, encryption, lookup };
}

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
