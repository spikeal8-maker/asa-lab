/** Public projection only: revisionNumber identifies an immutable publication revision. */
export interface PublicArtifactProvenance {
  readonly publicationId: string;
  readonly revisionNumber: number;
}

export type PublicArtifactViewerFamily = 'three-d' | 'electronics' | 'blocks';

/** v1 has no module payload or runtime/export capability. Extend via a new schema version. */
export interface PublicArtifactCapabilities {
  readonly readOnly: true;
  readonly interactive: false;
  readonly download: false;
}

export type PublicArtifact = {
  readonly schemaVersion: 1;
  readonly provenance: PublicArtifactProvenance;
  readonly capabilities: PublicArtifactCapabilities;
} & (
  | {
      readonly status: 'static-only';
      readonly viewerFamily: PublicArtifactViewerFamily;
      readonly reason: 'viewer-not-available';
    }
  | {
      readonly status: 'unsupported';
      readonly viewerFamily: null;
      readonly reason: 'unsupported-module';
    }
);

export const PUBLIC_ARTIFACT_V1_LIMITS = Object.freeze({
  maxBytes: 4096,
  maxDepth: 4,
  maxNodes: 32,
  maxStringLength: 128,
  maxRevisionNumber: 2_147_483_647,
});

export type PublicArtifactValidation =
  | { readonly ok: true; readonly artifact: PublicArtifact }
  | { readonly ok: false; readonly reason: 'invalid-public-artifact' };

type RecordValue = Record<string, unknown>;

/** Reject accessors, custom prototypes, symbols, cycles and hidden fields before reading values. */
function inspect(value: unknown, depth: number, budget: { nodes: number }): unknown {
  if (
    ++budget.nodes > PUBLIC_ARTIFACT_V1_LIMITS.maxNodes ||
    depth > PUBLIC_ARTIFACT_V1_LIMITS.maxDepth
  )
    throw new Error('bounds');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= PUBLIC_ARTIFACT_V1_LIMITS.maxStringLength)
    return value;
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error('shape');
  const keys = Reflect.ownKeys(value);
  if (keys.length > PUBLIC_ARTIFACT_V1_LIMITS.maxNodes) throw new Error('bounds');
  const copy: RecordValue = Object.create(null) as RecordValue;
  for (const key of keys) {
    if (typeof key !== 'string' || key.length > PUBLIC_ARTIFACT_V1_LIMITS.maxStringLength)
      throw new Error('key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('field');
    copy[key] = inspect(descriptor.value, depth + 1, budget);
  }
  return copy;
}

function record(value: unknown, keys: readonly string[]): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('record');
  const object = value as RecordValue;
  const actual = Object.keys(object);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key)))
    throw new Error('fields');
  return object;
}

/** No coercion or raw-JSON escape hatch. Failure never echoes potentially private input. */
export function validatePublicArtifact(input: unknown): PublicArtifactValidation {
  try {
    const safe = inspect(input, 0, { nodes: 0 });
    if (
      new TextEncoder().encode(JSON.stringify(safe)).byteLength > PUBLIC_ARTIFACT_V1_LIMITS.maxBytes
    )
      throw new Error('bytes');
    const envelope = record(safe, [
      'schemaVersion',
      'provenance',
      'capabilities',
      'status',
      'viewerFamily',
      'reason',
    ]);
    if (envelope.schemaVersion !== 1) throw new Error('version');
    const provenance = record(envelope.provenance, ['publicationId', 'revisionNumber']);
    if (
      typeof provenance.publicationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        provenance.publicationId,
      ) ||
      typeof provenance.revisionNumber !== 'number' ||
      !Number.isInteger(provenance.revisionNumber) ||
      provenance.revisionNumber < 1 ||
      provenance.revisionNumber > PUBLIC_ARTIFACT_V1_LIMITS.maxRevisionNumber
    )
      throw new Error('provenance');
    const capabilities = record(envelope.capabilities, ['readOnly', 'interactive', 'download']);
    if (
      capabilities.readOnly !== true ||
      capabilities.interactive !== false ||
      capabilities.download !== false
    )
      throw new Error('capabilities');
    const common = {
      schemaVersion: 1 as const,
      provenance: Object.freeze({
        publicationId: provenance.publicationId,
        revisionNumber: provenance.revisionNumber,
      }),
      capabilities: Object.freeze({
        readOnly: true as const,
        interactive: false as const,
        download: false as const,
      }),
    };
    let artifact: PublicArtifact;
    if (
      envelope.status === 'static-only' &&
      envelope.reason === 'viewer-not-available' &&
      (envelope.viewerFamily === 'three-d' ||
        envelope.viewerFamily === 'electronics' ||
        envelope.viewerFamily === 'blocks')
    ) {
      artifact = {
        ...common,
        status: 'static-only',
        viewerFamily: envelope.viewerFamily,
        reason: 'viewer-not-available',
      };
    } else if (
      envelope.status === 'unsupported' &&
      envelope.reason === 'unsupported-module' &&
      envelope.viewerFamily === null
    ) {
      artifact = {
        ...common,
        status: 'unsupported',
        viewerFamily: null,
        reason: 'unsupported-module',
      };
    } else throw new Error('outcome');
    return Object.freeze({ ok: true, artifact: Object.freeze(artifact) });
  } catch {
    return Object.freeze({ ok: false, reason: 'invalid-public-artifact' });
  }
}
