// Local-only server secrets for the owner demo and the E2E stack.
//
// The class-code pepper is a server-side key: it never appears in the
// repository, in the console or in a URL. It is created once under
// LOCALAPPDATA next to the other local credentials and reused afterwards.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const LOCAL_DIR = join(process.env.LOCALAPPDATA ?? '.', 'asa-lab-devenv');
const PEPPER_FILE = join(LOCAL_DIR, 'join-code-pepper.json');

/** Reads the local class-code pepper, creating it on first use. */
export function resolveJoinCodePepper() {
  if (existsSync(PEPPER_FILE)) {
    try {
      const stored = JSON.parse(readFileSync(PEPPER_FILE, 'utf8'));
      if (typeof stored?.pepper === 'string' && stored.pepper.length >= 32) {
        return stored.pepper;
      }
    } catch {
      // A damaged file is replaced below rather than failing the demo.
    }
  }
  const pepper = randomBytes(32).toString('hex');
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(PEPPER_FILE, JSON.stringify({ pepper }), 'utf8');
  return pepper;
}
