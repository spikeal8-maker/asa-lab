import type pg from 'pg';
import { PgProjectRepository } from '@asa-lab/projects';
import { BlocksRuntimeCapabilityService } from './blocks-runtime-capability.js';
import { BlocksProjectRuntimeAuthority } from './blocks-runtime-authority.js';
import { readBlocksRuntimeServerConfig } from './blocks-runtime-config.js';
import {
  BlocksRuntimeSessionService,
  type BlocksRuntimeParentActor,
  type BlocksRuntimeSessionResult,
} from './blocks-runtime-session.js';

export interface BlocksRuntimeSessionIssuerPort {
  issueEditor(
    actor: BlocksRuntimeParentActor,
    projectId: string,
  ): Promise<BlocksRuntimeSessionResult>;
}

export class BlocksRuntimeSessionIssuer implements BlocksRuntimeSessionIssuerPort {
  constructor(
    private readonly pool: pg.Pool | null,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async issueEditor(
    actor: BlocksRuntimeParentActor,
    projectId: string,
  ): Promise<BlocksRuntimeSessionResult> {
    if (!this.pool) return { ok: false, code: 'dependency_unavailable' };
    try {
      const config = readBlocksRuntimeServerConfig(this.env);
      const projects = new PgProjectRepository(this.pool);
      const authority = new BlocksProjectRuntimeAuthority(projects);
      const capability = new BlocksRuntimeCapabilityService({
        key: config.signingKey,
        runtimeOrigin: config.runtimeOrigin,
        authority,
      });
      return new BlocksRuntimeSessionService(
        projects,
        capability,
        config.runtimeOrigin,
      ).issueEditor(actor, projectId);
    } catch {
      return { ok: false, code: 'dependency_unavailable' };
    }
  }
}
