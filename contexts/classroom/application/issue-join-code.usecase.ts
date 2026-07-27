import { generateJoinCode, joinCodeDigest } from '../domain/join-code.js';
import type { JoinCodeDirectoryPort, JoinCodePepperPort } from './join-code.ports.js';

export type IssueJoinCodeResult =
  | { readonly ok: true; readonly code: string; readonly version: number }
  | { readonly ok: false; readonly reason: 'unavailable' };

/**
 * Issues (or rotates) the class code.
 *
 * The plaintext code is returned exactly once, to the teacher who asked for
 * it; only its keyed digest is stored, so it can never be read back later.
 * Issuing a new code revokes the previous one in the same step.
 */
export class IssueJoinCodeUseCase {
  constructor(
    private readonly directory: JoinCodeDirectoryPort,
    private readonly pepper: JoinCodePepperPort,
  ) {}

  async execute(tenantId: string, classroomId: string): Promise<IssueJoinCodeResult> {
    const pepper = this.pepper.pepper();
    if (pepper === null) {
      return { ok: false, reason: 'unavailable' };
    }
    const code = generateJoinCode();
    const issued = await this.directory.issue(tenantId, classroomId, joinCodeDigest(code, pepper));
    return { ok: true, code, version: issued.version };
  }
}
