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

// Fence the actual asynchronous collection interval, not just its final state.
// A write already pending before GET can finish without changing writeEpoch.
export async function collectCompletedEvidence<T>(
  current: () => EvidenceStamp,
  collect: () => Promise<{
    server: { draft: { revision: number } };
    expectedDraft: { revision: number };
    evidence: T;
  }>,
  verifyFresh: () => Promise<void>,
) {
  const before = structuredClone(current());
  const collected = await collect();
  const after = structuredClone(current());
  if (
    before.pendingWrites !== 0 ||
    after.pendingWrites !== 0 ||
    !isDeepStrictEqual({ ...before, checkpoint: 'complete' }, after)
  ) {
    // Do not seal old observer data with a newer Worker prefix, or a pre-write
    // GET with a post-write epoch. A single fresh mandatory verification is
    // required; an ongoing/racing write is a failure, never a retry loop.
    const freshBefore = structuredClone(current());
    if (freshBefore.pendingWrites !== 0)
      throw new Error('Cannot verify completed evidence during a pending write');
    await verifyFresh();
    if (!isDeepStrictEqual(freshBefore, current()))
      throw new Error('Completed evidence changed during mandatory verification');
    return undefined;
  }
  return sealCompletedEvidence(
    after,
    collected.server,
    collected.expectedDraft,
    collected.evidence,
  );
}

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
