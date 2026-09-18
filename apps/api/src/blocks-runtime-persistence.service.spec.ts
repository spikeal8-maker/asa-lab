import { describe, expect, it } from 'vitest';
import type { SaveDraftUseCase } from '@asa-lab/projects';
import {
  BLOCKS_RUNTIME_REQUEST_LIMIT,
  BLOCKS_RUNTIME_REQUEST_WINDOW_MS,
  BlocksRuntimePersistenceService,
} from './blocks-runtime-persistence.service.js';

const grant = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  principalId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  mode: 'editor' as const,
  versionId: null,
  permissions: [
    'project:read',
    'asset:read',
    'asset:write',
    'draft:write',
    'snapshot:write',
  ] as const,
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 600,
  tokenId: '44444444-4444-4444-8444-444444444444',
};

function makeService() {
  return new BlocksRuntimePersistenceService(null, {} as SaveDraftUseCase, {});
}
describe('BlocksRuntimePersistenceService request budget', () => {
  it('uses the selected school-NAT-safe per-capability ceiling', () => {
    expect(BLOCKS_RUNTIME_REQUEST_LIMIT).toBe(2400);
    expect(BLOCKS_RUNTIME_REQUEST_WINDOW_MS).toBe(10 * 60 * 1000);
    const service = makeService();
    for (let index = 0; index < BLOCKS_RUNTIME_REQUEST_LIMIT; index += 1) {
      expect(service.consumeRequest(grant).allowed).toBe(true);
    }
    const blocked = service.consumeRequest(grant);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('fails closed when production persistence dependencies are unavailable', async () => {
    const service = makeService();
    const result = await service.authorize({
      authorization: 'Bearer unavailable',
      origin: 'http://127.0.0.1:4613',
      projectId: grant.projectId,
      permission: 'draft:write',
    });
    expect(result).toEqual({ ok: false, code: 'dependency_unavailable' });
  });
});
