import type pg from 'pg';
import type { ProjectDraftPersistenceGuardPort } from '@asa-lab/projects';
import { BlocksDraftPersistenceGuard } from './blocks-persistence.guard.js';
import { PgBlocksAssetMetadataStore } from './blocks-asset-storage.js';

export function createBlocksDraftPersistenceGuard(pool: pg.Pool): ProjectDraftPersistenceGuardPort {
  return new BlocksDraftPersistenceGuard(new PgBlocksAssetMetadataStore(pool));
}
