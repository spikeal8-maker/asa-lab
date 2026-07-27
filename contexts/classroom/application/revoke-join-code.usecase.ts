import type { JoinCodeDirectoryPort } from './join-code.ports.js';

/** Revokes the active class code; afterwards it resolves to nothing. */
export class RevokeJoinCodeUseCase {
  constructor(private readonly directory: JoinCodeDirectoryPort) {}

  async execute(tenantId: string, classroomId: string): Promise<{ revoked: number }> {
    return { revoked: await this.directory.revoke(tenantId, classroomId) };
  }
}
