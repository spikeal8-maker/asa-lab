import { describe, expect, it } from 'vitest';
import {
  sealCompletedEvidence,
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
