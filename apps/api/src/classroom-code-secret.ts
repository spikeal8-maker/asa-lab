import { createHash } from 'node:crypto';
import { classroomCodeSecretMaterial } from './credential-configuration.cjs';

/** Stable server-only material used to derive recoverable display codes. The
 * database stores only hashes. Production requires independent explicit material;
 * isolated local/test stacks retain their restricted-runtime fallback. */
export function classroomCodeSecret(): string {
  return createHash('sha256')
    .update(`classroom-code:${classroomCodeSecretMaterial()}`)
    .digest('hex');
}
