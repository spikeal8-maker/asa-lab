import { createHash } from 'node:crypto';

/** Stable server-only material used to derive recoverable display codes. The
 * database stores only hashes. Deployments can rotate to an explicit secret;
 * local/test stacks derive it from their restricted runtime connection. */
export function classroomCodeSecret(): string {
  const explicit = process.env['CLASSROOM_CODE_SECRET'];
  if (explicit) {
    return createHash('sha256').update(`classroom-code:${explicit}`).digest('hex');
  }

  const databaseUrl =
    process.env['APP_DATABASE_URL'] ??
    process.env['APP_TEST_DATABASE_URL'] ??
    process.env['DATABASE_URL'] ??
    'asa-lab-isolated-test-runtime';

  // A database hostname differs between Docker, WSL and host-side tools. The
  // password remains stable, so deriving from it keeps a classroom code usable
  // across those runtime boundaries without storing the display code itself.
  let material = databaseUrl;
  try {
    material = new URL(databaseUrl).password || databaseUrl;
  } catch {
    // Non-URL test material remains a valid deterministic fallback.
  }

  return createHash('sha256').update(`classroom-code:${material}`).digest('hex');
}
