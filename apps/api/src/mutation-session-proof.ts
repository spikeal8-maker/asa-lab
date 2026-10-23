/** Server-owned evidence from an authoritative route lookup, never HTTP status,
 * cookies alone, or client-provided metadata. This evidence grants only a
 * mutation budget; every route still authenticates and authorizes its request. */
export type MutationProofPolicy = 'account' | 'seat-legacy' | 'seat-existing';
type Observer = (policy: MutationProofPolicy, token: string) => void;
const observers = new WeakMap<object, Observer>();

export function observeMutationSession(request: object, observer: Observer): void {
  observers.set(request, observer);
}

export function noteAuthoritativeMutationSession(
  request: object,
  policy: MutationProofPolicy,
  token: string | undefined,
): void {
  if (!token) return;
  try {
    observers.get(request)?.(policy, token);
  } catch {
    // Admission accounting must not change an authoritative resolver's result.
  }
}

export interface MutationAdmissionDiagnostics {
  readonly blockedBudget:
    | 'session'
    | 'shared_address'
    | 'anonymous_address'
    | 'new_proof_work'
    | 'pending_proofs'
    | 'invalid_proof';
}
export const requestMutationAdmission = new WeakMap<object, MutationAdmissionDiagnostics>();
