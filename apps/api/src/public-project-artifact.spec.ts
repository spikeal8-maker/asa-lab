import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';
import { PublicArtifactService } from './public-project-artifact.js';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
// Projection tests isolate the module boundary; real canonical parser is exercised in HTTP/PG.
function registry(): ModuleRegistry {
  return {
    get: () => ({ provider: { validate: (payload: unknown) => ({ ok: true, payload }) } }),
  } as unknown as ModuleRegistry;
}
const publication = '123e4567-e89b-42d3-a456-426614174001';
const revision = '123e4567-e89b-42d3-a456-426614174002';
function source() {
  return {
    publication_id: publication,
    revision_id: revision,
    revision_no: 1,
    module_key: 'electronics',
    document_json: {
      schemaVersion: 4,
      components: [
        {
          id: 'r',
          kind: 'resistor',
          position: { x: 0, y: 0 },
          value: 330,
          stateProperties: { code: 'PRIVATE ARDUINO SOURCE', password: 'secret' },
        },
      ],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    },
  };
}
function setup() {
  const row = source();
  const query = vi.fn().mockResolvedValue({ rows: [row] });
  const pool = { query } as unknown as pg.Pool;
  return { row, query, pool, service: new PublicArtifactService(registry()) };
}
describe('exact public artifact service', () => {
  it('renders reserved-license Electronics through sanitized display without source or editor state', async () => {
    const { pool, service } = setup();
    const artifact = await service.read(pool, publication, revision);
    expect(artifact.schemaVersion).toBe(2);
    expect(JSON.stringify(artifact)).not.toMatch(
      /PRIVATE|password|simulation|viewport|stateProperties/,
    );
    expect(artifact.provenance.revisionNumber).toBe(1);
  });
  it('reauthorizes every cache hit and refuses revoked/stale publications', async () => {
    const { pool, service, query } = setup();
    await service.read(pool, publication, revision);
    await service.read(pool, publication, revision);
    expect(query).toHaveBeenCalledTimes(2);
    query.mockResolvedValue({ rows: [] });
    await expect(service.read(pool, publication, revision)).rejects.toThrow();
  });
  it('keeps immutable published artifact when raw mutable fixture changes', async () => {
    const { pool, service, row } = setup();
    const first = await service.read(pool, publication, revision);
    row.document_json.components[0]!.value = 999;
    expect(await service.read(pool, publication, revision)).toBe(first);
  });
  it('honestly returns unchanged v1 for unsupported or oversized documents', async () => {
    const { pool, service, row } = setup();
    row.document_json.components[0]!.position.x = 100001;
    expect(await service.read(pool, publication, revision)).toMatchObject({
      schemaVersion: 1,
      status: 'static-only',
    });
  });
  it('rejects wrong publication/revision even if a query mock returns one', async () => {
    const { pool, service } = setup();
    await expect(
      service.read(pool, publication, '123e4567-e89b-42d3-a456-426614174099'),
    ).rejects.toThrow();
  });
  it('serves a burst of 15 distinct publications with at most eight active fresh reads', async () => {
    const { pool, service, query } = setup();
    let active = 0,
      peak = 0;
    const pending: Array<() => void> = [];
    query.mockImplementation(
      (_sql: string, params: string[]) =>
        new Promise((resolve) => {
          active++;
          peak = Math.max(peak, active);
          pending.push(() => {
            active--;
            resolve({ rows: [{ ...source(), publication_id: params[0] }] });
          });
        }),
    );
    const reads = Array.from({ length: 15 }, (_, i) =>
      service.read(pool, `123e4567-e89b-42d3-a456-${String(i).padStart(12, '0')}`, revision),
    );
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(8));
    while (pending.length) {
      pending.shift()!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(reads);
    expect(query).toHaveBeenCalledTimes(15);
    expect(peak).toBe(8);
    expect(active).toBe(0);
  });
  it('bounds queued requests and removes timeouts without leaking capacity or timers', async () => {
    vi.useFakeTimers();
    try {
      const { pool, service, query } = setup();
      const pending: Array<(value: unknown) => void> = [];
      query.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
      const active = Array.from({ length: 8 }, () => service.read(pool, publication, revision));
      const settledActive = Promise.allSettled(active);
      await Promise.resolve();
      const queued = Array.from({ length: 64 }, () => service.read(pool, publication, revision));
      const settledQueued = Promise.allSettled(queued);
      await expect(service.read(pool, publication, revision)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5000);
      expect((await settledQueued).every((r) => r.status === 'rejected')).toBe(true);
      expect(query).toHaveBeenCalledTimes(8);
      pending.splice(0).forEach((resolve) => resolve({ rows: [] }));
      await settledActive;
      query.mockResolvedValue({ rows: [source()] });
      await expect(service.read(pool, publication, revision)).resolves.toMatchObject({
        schemaVersion: 2,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('releases a slot after database failure and freshly authorizes the next waiting request', async () => {
    const { pool, service, query } = setup();
    const pending: Array<(v: unknown) => void> = [];
    query.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const reads = Array.from({ length: 8 }, () => service.read(pool, publication, revision));
    const settled = Promise.allSettled(reads);
    await Promise.resolve();
    const queued = service.read(pool, publication, revision);
    const queuedResult = Promise.allSettled([queued]);
    query.mockRejectedValueOnce(new Error('database failure'));
    pending.shift()!({ rows: [] });
    await queuedResult;
    expect(query).toHaveBeenCalledTimes(9);
    pending.splice(0).forEach((resolve) => resolve({ rows: [] }));
    await settled;
    query.mockResolvedValue({ rows: [source()] });
    await expect(service.read(pool, publication, revision)).resolves.toBeDefined();
  });
});
