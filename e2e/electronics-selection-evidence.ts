import { isDeepStrictEqual } from 'node:util';

export type EvidenceStamp = {
  projectId: string;
  checkpoint: string;
  pageIdentity: number;
  pageUrl: string;
  revision: number;
  writeEpoch: number;
  pendingWrites: number;
  putCount: number;
  workerCount: number;
};

// A point-in-time receipt, not a cache of assumed current server state.
// The caller must invalidate its stamp for every subsequent write/worker delivery.
export function sealCompletedEvidence<T>(
  stamp: EvidenceStamp,
  server: { draft: { revision: number } },
  expectedDraft: { revision: number },
  evidence: T,
) {
  if (
    stamp.checkpoint !== 'complete' ||
    !stamp.projectId ||
    !stamp.pageUrl ||
    stamp.pendingWrites !== 0 ||
    ![
      stamp.pageIdentity,
      stamp.revision,
      stamp.writeEpoch,
      stamp.putCount,
      stamp.workerCount,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    stamp.revision !== expectedDraft.revision ||
    !isDeepStrictEqual(server.draft, expectedDraft)
  )
    throw new Error('Cannot seal unverified completed evidence');
  const sealedStamp = structuredClone(stamp);
  const sealedEvidence = structuredClone(evidence);
  return {
    read(current: EvidenceStamp): T | undefined {
      if (!isDeepStrictEqual(current, sealedStamp)) return undefined;
      return structuredClone(sealedEvidence);
    },
  };
}
