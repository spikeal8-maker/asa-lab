import { describe, expect, it } from 'vitest';
import type { Provider } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { BlocksDraftPersistenceGuard } from './blocks-persistence.guard.js';
import { PgBlocksAssetMetadataStore } from './blocks-asset-storage.js';
import { TOKENS } from './tokens.js';

function providerFor(token: string): { useFactory: () => unknown } {
  const provider = (AppModule.forPool(null).providers ?? []).find(
    (candidate: Provider) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'provide' in candidate &&
      candidate.provide === token,
  );
  if (!provider || typeof provider !== 'object' || !('useFactory' in provider)) {
    throw new Error(`Missing factory provider ${token}`);
  }
  return provider as { useFactory: () => unknown };
}

describe('Blocks production draft composition', () => {
  it('keeps the common SaveDraftUseCase behind the Blocks durability guard', () => {
    const useCase = providerFor(TOKENS.saveDraftUseCase).useFactory();
    const guard = (useCase as { persistenceGuard?: unknown }).persistenceGuard;
    expect(guard).toBeInstanceOf(BlocksDraftPersistenceGuard);
    const metadata = (guard as { metadata?: unknown }).metadata;
    expect(metadata).toBeInstanceOf(PgBlocksAssetMetadataStore);
  });
});
