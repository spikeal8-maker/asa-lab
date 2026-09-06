import type { ThreeDDocument } from '@asa-lab/three-d';

export type BooleanResultStatus = 'pending' | 'ready' | 'valid-empty' | 'stale' | 'error';

export interface BooleanGroupResultState {
  readonly groupId: string;
  readonly label: string;
  readonly status: BooleanResultStatus;
  readonly message?: string;
}

/** Ephemeral evaluated state, never part of the saved source document. */
export interface GeometryResultState {
  readonly documentSignature: string;
  readonly groups: readonly BooleanGroupResultState[];
}

export function geometryResultStatus(state: GeometryResultState): BooleanResultStatus | 'idle' {
  if (state.groups.some((group) => group.status === 'pending')) return 'pending';
  if (state.groups.some((group) => group.status === 'stale')) return 'stale';
  if (state.groups.some((group) => group.status === 'error')) return 'error';
  if (state.groups.length === 0) return 'idle';
  return state.groups.every((group) => group.status === 'valid-empty') ? 'valid-empty' : 'ready';
}

export function geometryResultIsCurrent(
  state: GeometryResultState | null,
  document: ThreeDDocument,
): boolean {
  return Boolean(
    state &&
    state.documentSignature === JSON.stringify(document.nodes) &&
    state.groups.every((group) => group.status === 'ready' || group.status === 'valid-empty'),
  );
}
