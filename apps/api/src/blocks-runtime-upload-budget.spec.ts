import { describe, expect, it } from 'vitest';
import type { BlocksRuntimeGrant } from './blocks-runtime-capability.js';
import {
  BLOCKS_CAPABILITY_NEW_BYTES,
  BLOCKS_PROJECT_WINDOW_NEW_BYTES,
  BLOCKS_PROJECT_WINDOW_SECONDS,
  BlocksRuntimeUploadBudget,
} from './blocks-runtime-upload-budget.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
function grant(tokenId = crypto.randomUUID(), projectId = PROJECT): BlocksRuntimeGrant {
  return {
    tenantId: TENANT,
    principalId: PRINCIPAL,
    projectId,
    mode: 'editor',
    versionId: null,
    permissions: ['project:read', 'asset:read', 'asset:write', 'draft:write', 'snapshot:write'],
    issuedAt: 1000,
    expiresAt: 1600,
    tokenId,
  };
}
describe('Blocks runtime upload budget', () => {
  it('allows four concurrent uploads and releases leases idempotently', () => {
    let now = 1000;
    const budget = new BlocksRuntimeUploadBudget(() => now);
    const g = grant();
    const leases = Array.from({ length: 4 }, () => budget.begin(g));
    expect(leases.every((entry) => entry.ok)).toBe(true);
    expect(budget.begin(g)).toEqual({ ok: false, code: 'too_many_uploads' });
    const first = leases[0]!;
    if (!first.ok) throw new Error('lease missing');
    first.value.release();
    first.value.release();
    expect(budget.begin(g).ok).toBe(true);
    now += 1;
  });

  it('charges committed unique bytes and does not charge released reservations', () => {
    const budget = new BlocksRuntimeUploadBudget(() => 1000);
    const g = grant();
    const failed = budget.reserveNewBytes(g, 25 * 1024 * 1024);
    if (!failed.ok) throw new Error('reservation missing');
    failed.value.release();
    const exact = budget.reserveNewBytes(g, BLOCKS_CAPABILITY_NEW_BYTES);
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    exact.value.commit();
    expect(budget.reserveNewBytes(g, 1)).toEqual({ ok: false, code: 'capability_byte_budget' });
  });
  it('shares the five-minute project budget across different capabilities', () => {
    const budget = new BlocksRuntimeUploadBudget(() => 1000);
    const first = budget.reserveNewBytes(grant(), BLOCKS_CAPABILITY_NEW_BYTES);
    const second = budget.reserveNewBytes(grant(), BLOCKS_CAPABILITY_NEW_BYTES);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    first.value.commit();
    second.value.commit();
    expect(budget.reserveNewBytes(grant(), 1)).toEqual({ ok: false, code: 'project_byte_budget' });
  });

  it('starts a fresh project window after five minutes when no reservation is active', () => {
    let now = 1000;
    const budget = new BlocksRuntimeUploadBudget(() => now);
    const first = budget.reserveNewBytes(grant(), BLOCKS_CAPABILITY_NEW_BYTES);
    const second = budget.reserveNewBytes(grant(), BLOCKS_CAPABILITY_NEW_BYTES);
    if (!first.ok || !second.ok) throw new Error('reservation missing');
    first.value.commit();
    second.value.commit();
    now += BLOCKS_PROJECT_WINDOW_SECONDS;
    const next = budget.reserveNewBytes(grant(), 1);
    expect(next.ok).toBe(true);
  });

  it('fails closed for expired capabilities and invalid byte counts', () => {
    const budget = new BlocksRuntimeUploadBudget(() => 1600);
    expect(budget.begin(grant())).toEqual({ ok: false, code: 'budget_state_unavailable' });
    expect(budget.reserveNewBytes(grant(), 0)).toEqual({
      ok: false,
      code: 'budget_state_unavailable',
    });
  });
  it('counts pending reservations immediately and releases them without underflow', () => {
    const budget = new BlocksRuntimeUploadBudget(() => 1000);
    const g = grant();
    const held = budget.reserveNewBytes(g, BLOCKS_CAPABILITY_NEW_BYTES);
    if (!held.ok) throw new Error('reservation missing');
    expect(budget.reserveNewBytes(g, 1)).toEqual({
      ok: false,
      code: 'capability_byte_budget',
    });
    held.value.release();
    held.value.release();
    expect(budget.reserveNewBytes(g, BLOCKS_CAPABILITY_NEW_BYTES).ok).toBe(true);
  });

  it('rejects one request that exceeds either configured byte ceiling', () => {
    const budget = new BlocksRuntimeUploadBudget(() => 1000);
    expect(budget.reserveNewBytes(grant(), BLOCKS_CAPABILITY_NEW_BYTES + 1)).toEqual({
      ok: false,
      code: 'capability_byte_budget',
    });
    expect(BLOCKS_PROJECT_WINDOW_NEW_BYTES).toBe(BLOCKS_CAPABILITY_NEW_BYTES * 2);
  });
});
