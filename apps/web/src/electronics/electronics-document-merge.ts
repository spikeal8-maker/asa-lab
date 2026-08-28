import { parseElectronicsDocument } from '@asa-lab/electronics';
import type { SchematicComponent, SchematicConnection, SchematicDocument } from '../api';

export interface ElectronicsMergeConflict {
  readonly path: string;
}

export type ElectronicsMergeResult =
  | { readonly ok: true; readonly document: SchematicDocument }
  | { readonly ok: false; readonly conflicts: readonly ElectronicsMergeConflict[] };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function electronicsDocumentsEqual(
  left: SchematicDocument,
  right: SchematicDocument,
): boolean {
  return same(
    {
      schemaVersion: left.schemaVersion,
      components: left.components,
      connections: left.connections,
      maxIterations: left.simulation.maxIterations,
    },
    {
      schemaVersion: right.schemaVersion,
      components: right.components,
      connections: right.connections,
      maxIterations: right.simulation.maxIterations,
    },
  );
}

type NodeMerge =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly conflicts: readonly ElectronicsMergeConflict[] };

/**
 * Three-way property merge. Arrays are atomic on purpose: terminal lists and
 * wire vertices have semantic order, so combining two different arrays would
 * invent a circuit neither collaborator drew.
 */
function mergeNode(base: unknown, local: unknown, remote: unknown, path: string): NodeMerge {
  if (same(local, remote)) return { ok: true, value: local };
  if (same(local, base)) return { ok: true, value: remote };
  if (same(remote, base)) return { ok: true, value: local };

  if (isRecord(local) && isRecord(remote) && (base === undefined || isRecord(base))) {
    const baseRecord = isRecord(base) ? base : {};
    const keys = [
      ...new Set([...Object.keys(baseRecord), ...Object.keys(remote), ...Object.keys(local)]),
    ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const value: Record<string, unknown> = {};
    const conflicts: ElectronicsMergeConflict[] = [];
    for (const key of keys) {
      const child = mergeNode(baseRecord[key], local[key], remote[key], `${path}.${key}`);
      if (!child.ok) {
        conflicts.push(...child.conflicts);
      } else if (child.value !== undefined) {
        value[key] = child.value;
      }
    }
    return conflicts.length > 0 ? { ok: false, conflicts } : { ok: true, value };
  }

  return { ok: false, conflicts: [{ path }] };
}

function mergeEntities<T extends { readonly id: string }>(
  kind: 'components' | 'connections',
  base: readonly T[],
  local: readonly T[],
  remote: readonly T[],
): { readonly values: T[]; readonly conflicts: readonly ElectronicsMergeConflict[] } {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  // Remote order is the latest shared z-order. Independent local additions are
  // appended in their local order, which is deterministic and preserves intent.
  const ids = [
    ...remote.map((item) => item.id),
    ...local.map((item) => item.id).filter((id) => !remoteById.has(id)),
    ...base.map((item) => item.id).filter((id) => !remoteById.has(id) && !localById.has(id)),
  ];
  const uniqueIds = [...new Set(ids)];
  const values: T[] = [];
  const conflicts: ElectronicsMergeConflict[] = [];
  for (const id of uniqueIds) {
    const merged = mergeNode(
      baseById.get(id),
      localById.get(id),
      remoteById.get(id),
      `${kind}.${id}`,
    );
    if (!merged.ok) {
      conflicts.push(...merged.conflicts);
    } else if (merged.value !== undefined) {
      values.push(merged.value as T);
    }
  }
  return { values, conflicts };
}

/**
 * Safely combines independent edits made from the same server revision.
 * A property changed differently by two people remains a visible conflict;
 * there is deliberately no silent last-write-wins fallback.
 */
export function mergeElectronicsDocuments(
  base: SchematicDocument,
  local: SchematicDocument,
  remote: SchematicDocument,
): ElectronicsMergeResult {
  const components = mergeEntities<SchematicComponent>(
    'components',
    base.components,
    local.components,
    remote.components,
  );
  const connections = mergeEntities<SchematicConnection>(
    'connections',
    base.connections,
    local.connections,
    remote.connections,
  );
  const maxIterations = mergeNode(
    base.simulation.maxIterations,
    local.simulation.maxIterations,
    remote.simulation.maxIterations,
    'simulation.maxIterations',
  );
  if (!maxIterations.ok) return { ok: false, conflicts: maxIterations.conflicts };
  const conflicts = [...components.conflicts, ...connections.conflicts];
  if (conflicts.length > 0) return { ok: false, conflicts };

  const candidate = {
    schemaVersion: 4,
    components: components.values,
    connections: connections.values,
    // Viewport and running state describe the local editor session, not shared
    // circuit intent. Keeping the local values prevents one collaborator's pan
    // or Start button from moving another collaborator's screen.
    viewport: local.viewport,
    simulation: {
      running: local.simulation.running,
      maxIterations: maxIterations.value as number,
    },
  } satisfies SchematicDocument;
  const parsed = parseElectronicsDocument(candidate);
  if (!parsed.ok) return { ok: false, conflicts: [{ path: 'document' }] };
  const componentIds = new Set(candidate.components.map((component) => component.id));
  if (
    candidate.connections.some(
      (connection) =>
        !componentIds.has(connection.from.componentId) ||
        !componentIds.has(connection.to.componentId),
    )
  ) {
    return { ok: false, conflicts: [{ path: 'connections' }] };
  }
  return { ok: true, document: candidate };
}
