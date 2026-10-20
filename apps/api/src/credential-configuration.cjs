// @ts-check
/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- This dependency-free CommonJS module is shared by the pre-build updater and the compiled API. */
const { timingSafeEqual } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { URL } = require('node:url');
const process = require('node:process');

/** @typedef {'off' | 'compat' | 'enforced'} StudentCodeProtectionMode */
/** @typedef {{ activeKeyId: string, keys: Map<string, Buffer> }} LoadedKeyring */
/** @typedef {{ mode: 'compat' | 'enforced', encryption: LoadedKeyring, lookup: LoadedKeyring }} StudentCodeProtectionConfig */

class StudentCodeProtectionConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'StudentCodeProtectionConfigError';
  }
}

class ClassroomCodeSecretConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ClassroomCodeSecretConfigError';
  }
}

const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** @param {NodeJS.ProcessEnv} env @returns {StudentCodeProtectionMode} */
function protectionMode(env) {
  const raw = env['ASA_STUDENT_CODE_PROTECTION_MODE']?.trim() || 'off';
  if (raw !== 'off' && raw !== 'compat' && raw !== 'enforced') {
    throw new StudentCodeProtectionConfigError(
      'ASA_STUDENT_CODE_PROTECTION_MODE must be off, compat, or enforced',
    );
  }
  if (env['NODE_ENV'] === 'production' && raw === 'off') {
    throw new StudentCodeProtectionConfigError(
      'ASA_STUDENT_CODE_PROTECTION_MODE must explicitly be compat or enforced in production',
    );
  }
  return raw;
}

/** @param {unknown} value @param {string} label @returns {Buffer} */
function decodeBase64Key(value, label) {
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

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} jsonName
 * @param {string} activeName
 * @param {number | undefined} exactBytes
 * @param {number | undefined} minimumBytes
 * @returns {LoadedKeyring}
 */
function loadKeyring(env, jsonName, activeName, exactBytes, minimumBytes) {
  const json = env[jsonName];
  const activeKeyId = env[activeName]?.trim();
  if (!json || !activeKeyId) {
    throw new StudentCodeProtectionConfigError(`${jsonName} and ${activeName} are required`);
  }
  if (!KEY_ID_PATTERN.test(activeKeyId)) {
    throw new StudentCodeProtectionConfigError(`${activeName} is invalid`);
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new StudentCodeProtectionConfigError(`${jsonName} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StudentCodeProtectionConfigError(`${jsonName} must be a JSON object`);
  }
  const keys = new Map();
  for (const [keyId, raw] of Object.entries(parsed)) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new StudentCodeProtectionConfigError(`${jsonName} contains an invalid key ID`);
    }
    // Configuration errors identify the setting, never the supplied key material.
    const key = decodeBase64Key(raw, jsonName);
    if (exactBytes !== undefined && key.length !== exactBytes) {
      throw new StudentCodeProtectionConfigError(
        `${jsonName} keys must decode to exactly ${exactBytes} bytes`,
      );
    }
    if (minimumBytes !== undefined && key.length < minimumBytes) {
      throw new StudentCodeProtectionConfigError(
        `${jsonName} keys must decode to at least ${minimumBytes} bytes`,
      );
    }
    keys.set(keyId, key);
  }
  if (!keys.has(activeKeyId)) {
    throw new StudentCodeProtectionConfigError(`${activeName} is absent from ${jsonName}`);
  }
  return { activeKeyId, keys };
}

/** @param {NodeJS.ProcessEnv} [env] @returns {StudentCodeProtectionConfig | null} */
function loadStudentCodeProtectionConfig(env = process.env) {
  const mode = protectionMode(env);
  if (mode === 'off') return null;
  const encryption = loadKeyring(
    env,
    'ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON',
    'ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID',
    32,
    undefined,
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

/**
 * Preserve existing explicit-secret bytes exactly. Production never derives
 * classroom identity from a database URL; isolated local/test stacks retain
 * their established fallback so no issued local card changes incidentally.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function classroomCodeSecretMaterial(env = process.env) {
  const explicit = env['CLASSROOM_CODE_SECRET'];
  if (env['NODE_ENV'] === 'production') {
    if (!explicit?.trim() || Buffer.byteLength(explicit, 'utf8') < 32) {
      throw new ClassroomCodeSecretConfigError(
        'CLASSROOM_CODE_SECRET must contain at least 32 bytes of independent secret material in production',
      );
    }
    for (const name of ['APP_DATABASE_URL', 'DATABASE_URL', 'APP_TEST_DATABASE_URL']) {
      const url = env[name];
      if (!url) continue;
      let password = '';
      try {
        password = decodeURIComponent(new URL(url).password);
      } catch {
        // An invalid database URL is validated by its own startup boundary.
      }
      if (explicit === url || explicit === password) {
        throw new ClassroomCodeSecretConfigError(
          'CLASSROOM_CODE_SECRET must be independent from database credentials',
        );
      }
    }
    return explicit;
  }
  if (explicit) return explicit;
  const databaseUrl =
    env['APP_DATABASE_URL'] ??
    env['APP_TEST_DATABASE_URL'] ??
    env['DATABASE_URL'] ??
    'asa-lab-isolated-test-runtime';
  try {
    return new URL(databaseUrl).password || databaseUrl;
  } catch {
    return databaseUrl;
  }
}

/** @param {string} secret @param {Buffer} key @returns {boolean} */
function reusesStudentKey(secret, key) {
  const raw = Buffer.from(secret, 'utf8');
  return (
    (raw.length === key.length && timingSafeEqual(raw, key)) ||
    secret === key.toString('base64') ||
    secret === key.toString('base64').replace(/=+$/u, '') ||
    secret === key.toString('base64url') ||
    secret.toLowerCase() === key.toString('hex')
  );
}

/**
 * Shared fail-closed boundary for startup, readiness and deployment preflight.
 * This validates global configuration only. Historical row failures belong to
 * the authorized credential operation and must not make unrelated APIs unready.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
function validateCredentialConfiguration(env = process.env) {
  const classSecret = classroomCodeSecretMaterial(env);
  const protection = loadStudentCodeProtectionConfig(env);
  if (env['NODE_ENV'] !== 'production' || !protection) return;
  for (const key of [...protection.encryption.keys.values(), ...protection.lookup.keys.values()]) {
    if (reusesStudentKey(classSecret, key)) {
      throw new ClassroomCodeSecretConfigError(
        'CLASSROOM_CODE_SECRET must be independent from all Student Code encryption and lookup keys',
      );
    }
  }
}

module.exports = {
  ClassroomCodeSecretConfigError,
  StudentCodeProtectionConfigError,
  classroomCodeSecretMaterial,
  loadStudentCodeProtectionConfig,
  validateCredentialConfiguration,
};
