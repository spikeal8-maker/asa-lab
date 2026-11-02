import { describe, expect, it } from 'vitest';
import {
  sealCompletedEvidence,
  collectCompletedEvidence,
  type EvidenceStamp,
} from '../../e2e/electronics-selection-evidence';

const stamp: EvidenceStamp = {
  projectId: 'isolated-project',
  checkpoint: 'complete',
  pageIdentity: 1,
  pageUrl: 'http://localhost/editor',
  revision: 4,
  writeEpoch: 2,
  pendingWrites: 0,
  putCount: 1,
  workerCount: 313,
};
const draft = {
  revision: 4,
  document: { source: 'whole saved source', components: [{ id: 'uno' }] },
};
const server = { draft };
function receipt() {
  return sealCompletedEvidence(stamp, server, draft, {
    server,
    observer: { documentId: 'original', through: 313 },
    storage: { draft: 'saved' },
  });
}
describe('verified complete checkpoint evidence', () => {
  it('reuses exact completed revision without another collection and protects the sealed value', () => {
    const sealed = receipt();
    const value = sealed.read(stamp)!;
    expect(value.server.draft).toEqual(draft);
    value.server.draft.document.source = 'mutated return value';
    expect(sealed.read(stamp)!.server.draft.document.source).toBe('whole saved source');
  });
  it.each([
    { checkpoint: 'whole-save' },
    { revision: 5 },
    { writeEpoch: 3 },
    { pendingWrites: 1 },
    { putCount: 2 },
    { workerCount: 314 },
    { projectId: 'another-project' },
    { pageIdentity: 2 },
    { pageUrl: 'http://localhost/elsewhere' },
  ])('requires fresh collection after changed identity/prefix %j', (changed) => {
    expect(receipt().read({ ...stamp, ...changed })).toBeUndefined();
  });
  it('rejects post-save changes including changed whole source at the same revision', () => {
    for (const changed of [
      { ...draft, revision: 5 },
      { ...draft, document: { ...draft.document, source: 'unexpected post-save modification' } },
      { ...draft, document: { ...draft.document, components: [] } },
    ])
      expect(() => sealCompletedEvidence(stamp, { draft: changed }, draft, {})).toThrow(
        'unverified',
      );
  });
  it('cannot seal a stale revision, pending write or incomplete identity', () => {
    for (const changed of [
      { checkpoint: 'whole-save' },
      { revision: 3 },
      { pendingWrites: 1 },
      { projectId: '' },
      { writeEpoch: NaN },
    ])
      expect(() => sealCompletedEvidence({ ...stamp, ...changed }, server, draft, {})).toThrow(
        'unverified',
      );
  });
});

describe('actual asynchronous completed-evidence caller interval', () => {
  function caller(initial: Partial<EvidenceStamp> = {}) {
    const state = { ...stamp, checkpoint: 'before-final-collection', ...initial };
    let actual = structuredClone(draft);
    let freshReads = 0;
    return {
      state,
      setActual: (next: typeof draft) => {
        actual = next;
      },
      freshReads: () => freshReads,
      run: (duringCheckpoint: () => void = () => {}) =>
        collectCompletedEvidence(
          () => state,
          async () => {
            // Same order as the real caller: GET, full assertion, observer/storage
            // checkpoint, then sealing. The GET result is its own immutable value.
            const read = structuredClone({ draft: actual });
            expect(read.draft).toEqual(draft);
            const observer = { through: state.workerCount };
            await Promise.resolve();
            duringCheckpoint();
            state.checkpoint = 'complete';
            return { server: read, expectedDraft: draft, evidence: { server: read, observer } };
          },
          async () => {
            freshReads++;
            expect(actual).toEqual(draft); // Mandatory; rejection must propagate.
          },
        ),
    };
  }
  it('fences before GET and rejects an already-pending POST restore completing after the read', async () => {
    const c = caller({ pendingWrites: 1 });
    await expect(
      c.run(() => {
        c.state.pendingWrites = 0; // requestfinished: epoch and PUT count unchanged.
        c.setActual({ ...draft, revision: 5 });
      }),
    ).rejects.toThrow();
    expect(c.freshReads()).toBe(1);
    expect(c.state.writeEpoch).toBe(stamp.writeEpoch);
    expect(c.state.putCount).toBe(1);
  });
  it('does not launder newly delivered Worker records into an older observer snapshot', async () => {
    const c = caller();
    const receipt = await c.run(() => {
      c.state.workerCount++;
    });
    expect(receipt).toBeUndefined();
    expect(c.freshReads()).toBe(1);
  });
  it('fails mandatory whole-document verification on a same-revision post-read source change', async () => {
    const c = caller();
    await expect(
      c.run(() => {
        c.state.writeEpoch++;
        c.setActual({ ...draft, document: { ...draft.document, source: 'changed after GET' } });
      }),
    ).rejects.toThrow();
    expect(c.freshReads()).toBe(1);
  });
  it('seals only a stable entire interval and still invalidates its receipt after completion', async () => {
    const c = caller();
    const sealed = (await c.run())!;
    expect(c.freshReads()).toBe(0);
    expect(sealed.read(c.state)!.observer.through).toBe(stamp.workerCount);
    c.state.workerCount++;
    expect(sealed.read(c.state)).toBeUndefined();
  });
  it('refuses reuse or fresh verification while a write remains in flight', async () => {
    const c = caller({ pendingWrites: 1 });
    await expect(c.run()).rejects.toThrow('pending write');
    expect(c.freshReads()).toBe(0);
  });
  it('does not seal even when an already-pending write finishes without a changed document', async () => {
    const c = caller({ pendingWrites: 1 });
    expect(
      await c.run(() => {
        c.state.pendingWrites = 0;
      }),
    ).toBeUndefined();
    expect(c.freshReads()).toBe(1);
  });
  it('fails closed if another write races the single mandatory fresh verification', async () => {
    const state = { ...stamp };
    await expect(
      collectCompletedEvidence(
        () => state,
        async () => {
          state.workerCount++;
          return { server, expectedDraft: draft, evidence: {} };
        },
        async () => {
          state.writeEpoch++;
        },
      ),
    ).rejects.toThrow('changed during mandatory verification');
  });
});
