// Local-only server secrets for the owner demo and the E2E stack.
//
// The class-code pepper is a server-side key: it never appears in the
// repository, in the console, in a URL or in telemetry. It is created once
// under LOCALAPPDATA next to the other local credentials and reused afterwards.
//
// Two rules make the failure modes safe rather than convenient:
//
//   * a damaged secret file is never silently replaced — every stored class
//     code digest was computed with the old key, so overwriting it would turn
//     working codes into dead ones with no explanation;
//   * a missing secret is only created when the caller says it is safe, which
//     it is not while active codes already exist in the database.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const LOCAL_DIR = join(process.env.LOCALAPPDATA ?? '.', 'asa-lab-devenv');
const PEPPER_FILE = join(LOCAL_DIR, 'join-code-pepper.json');

export function joinCodePepperFile() {
  return PEPPER_FILE;
}

export function joinCodePepperExists() {
  return existsSync(PEPPER_FILE);
}

/**
 * Reads the local class-code pepper.
 *
 * @param {{ create?: boolean }} options `create` allows a first-run secret to
 * be generated; without it a missing file is an error, so no caller can bring
 * the subsystem up with a fresh key by accident.
 */
export function resolveJoinCodePepper({ create = true } = {}) {
  if (existsSync(PEPPER_FILE)) {
    let stored;
    try {
      stored = JSON.parse(readFileSync(PEPPER_FILE, 'utf8'));
    } catch (error) {
      throw new Error(
        `class-code secret at ${PEPPER_FILE} is unreadable (${error instanceof Error ? error.message : String(error)}). It is not replaced automatically: every stored class code was digested with it. Restore the file from your backup, or rotate the class codes deliberately and then remove it.`,
      );
    }
    if (typeof stored?.pepper !== 'string' || stored.pepper.length < 32) {
      throw new Error(
        `class-code secret at ${PEPPER_FILE} is damaged. It is not replaced automatically: every stored class code was digested with it. Restore the file from your backup, or rotate the class codes deliberately and then remove it.`,
      );
    }
    return stored.pepper;
  }
  if (!create) {
    throw new Error(
      `class-code secret is missing at ${PEPPER_FILE} and was not created, because active class codes already exist. Restore the secret, or revoke and re-issue the codes before continuing.`,
    );
  }
  const pepper = randomBytes(32).toString('hex');
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(PEPPER_FILE, JSON.stringify({ pepper }), 'utf8');
  return pepper;
}
