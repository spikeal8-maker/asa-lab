import { generateJoinCode, joinCodeDigest } from '../domain/join-code.js';
import type { JoinCodeDirectoryPort, JoinCodeSecretPort } from './join-code.ports.js';

export type IssueJoinCodeResult =
  | { readonly ok: true; readonly code: string; readonly version: number }
  | { readonly ok: false; readonly reason: 'unavailable' };

/**
 * Issues (or rotates) the class code.
 *
 * The plaintext code is returned exactly once, to the caller who asked for it;
 * only its keyed digest is stored, so it can never be read back. Issuing a new
 * code revokes the previous one in the same step.
 *
 * C1.1 has no teacher-facing surface for this: the full issue/rotate/reveal
 * experience belongs to R5. Today it is reached only by the local provisioning
 * tool.
 */
export class IssueJoinCodeUseCase {
  constructor(
    private readonly directory: JoinCodeDirectoryPort,
    private readonly secrets: JoinCodeSecretPort,
  ) {}

  async execute(tenantId: string, classroomId: string): Promise<IssueJoinCodeResult> {
    const secret = this.secrets.secret();
    if (secret === null) {
      return { ok: false, reason: 'unavailable' };
    }
    const code = generateJoinCode();
    const issued = await this.directory.issue(tenantId, classroomId, joinCodeDigest(code, secret));
    return { ok: true, code, version: issued.version };
  }
}
