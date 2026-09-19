import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createBlocksDraftPersistenceGuard } from './blocks-draft-composition.js';
import { BlocksDraftPersistenceGuard } from './blocks-persistence.guard.js';
import { PgBlocksAssetMetadataStore } from './blocks-asset-storage.js';

describe('Blocks production draft composition', () => {
  it('creates the common Project Core durability guard without loading the whole AppModule', () => {
    const pool = {} as pg.Pool;
    const guard = createBlocksDraftPersistenceGuard(pool);
    expect(guard).toBeInstanceOf(BlocksDraftPersistenceGuard);
    const metadata = (guard as { metadata?: unknown }).metadata;
    expect(metadata).toBeInstanceOf(PgBlocksAssetMetadataStore);
  });
});
