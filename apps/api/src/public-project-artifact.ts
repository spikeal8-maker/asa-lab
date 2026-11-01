import type pg from 'pg';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import {
  validatePublicProjectDisplayArtifact,
  publicArduinoBlocks,
  PUBLIC_ELECTRONICS_PROPERTIES,
  PUBLIC_ELECTRONICS_EDITOR_PROPERTIES,
  type PublicProjectDisplayArtifact,
  type PublicArtifactProvenance,
} from '@asa-lab/contracts';
import { publicationError } from './public-projects.errors.js';
import { validationMessage } from './validation.js';

interface Source {
  publication_id: string;
  revision_id: string;
  revision_no: number;
  module_key: string;
  document_json: unknown;
}
type Adapter = (
  document: unknown,
  provenance: PublicArtifactProvenance,
) => PublicProjectDisplayArtifact | null;
const COMPONENT_KEYS = [
  'id',
  'kind',
  'componentTypeId',
  'variantId',
  'position',
  'value',
  'rotation',
  'name',
  'pinIds',
  'state',
] as const;
function pick(source: Record<string, unknown>, keys: readonly string[]) {
  const result: Record<string, unknown> = {};
  for (const key of keys) if (Object.hasOwn(source, key)) result[key] = source[key];
  return result;
}
function rawWithinBounds(value: unknown): boolean {
  let count = 0;
  const seen = new Set<object>();
  function visit(v: unknown, depth: number): void {
    if (++count > 70000 || depth > 12) throw Error();
    if (typeof v === 'string') {
      if (v.length > 524288) throw Error();
      return;
    }
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (!v || typeof v !== 'object' || seen.has(v)) throw Error();
    seen.add(v);
    if (Object.getPrototypeOf(v) !== (Array.isArray(v) ? Array.prototype : Object.prototype))
      throw Error();
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || !d?.enumerable || !('value' in d)) throw Error();
      visit(d.value, depth + 1);
    }
  }
  try {
    visit(value, 0);
    return Buffer.byteLength(JSON.stringify(value)) <= 1048576;
  } catch {
    return false;
  }
}
/** Registry contains projection functions, never module execution or copy commands. */
export function createPublicArtifactAdapters(
  registry: ModuleRegistry,
): ReadonlyMap<string, Adapter> {
  return new Map([
    [
      'electronics',
      (document, provenance) => {
        if (!rawWithinBounds(document)) return null;
        const entry = registry.get('electronics');
        if (!entry?.provider) return null;
        const parsed = validationMessage(entry, document);
        if (!parsed.ok) return null;
        const source = parsed.document as {
          components: Record<string, unknown>[];
          connections: Record<string, unknown>[];
          simulation: { maxIterations: number };
        };
        const candidate = {
          schemaVersion: 2,
          status: 'display',
          viewerFamily: 'electronics',
          provenance,
          capabilities: { readOnly: true, interactive: true, download: false },
          components: source.components.map((c) => {
            const component = pick(c, COMPONENT_KEYS);
            if (c.stateProperties && typeof c.stateProperties === 'object') {
              const visual = pick(c.stateProperties as Record<string, unknown>, [
                'mirrorX',
                'mirrorY',
                'pinLayout',
              ]);
              if (Object.keys(visual).length) component.visualProperties = visual;
            }
            return component;
          }),
          connections: source.connections.map((w) =>
            pick(w, ['id', 'from', 'to', 'color', 'vertices']),
          ),
        };
        const validated = validatePublicProjectDisplayArtifact(candidate);
        if (!validated.ok) return null;
        // Unknown physical configuration fails closed to the inert V2 viewer.
        // Only explicitly classified editor metadata is omitted from execution.
        const simulationComponents = source.components.map((c, index) => {
          const component = {
            ...candidate.components[index],
            ...pick(c, [
              'electricalModelId',
              'electricalModelVersion',
              'modelProfileId',
              'modelProfileVersion',
              'wiperPosition',
              'holeBindings',
              'internalConnections',
            ]),
          };
          if (c.stateProperties && typeof c.stateProperties === 'object') {
            const properties = c.stateProperties as Record<string, unknown>;
            if (
              Object.keys(properties).some(
                (key) =>
                  !PUBLIC_ELECTRONICS_PROPERTIES.includes(key) &&
                  !PUBLIC_ELECTRONICS_EDITOR_PROPERTIES.includes(key),
              )
            )
              return null;
            const projected = pick(properties, PUBLIC_ELECTRONICS_PROPERTIES);
            // Only the frozen published sketch may supply the public block graph.
            delete projected.arduinoBlocks;
            if (['blocks', 'blocks-text'].includes(String(properties.arduinoCodeMode))) {
              const blocks = publicArduinoBlocks(properties.arduinoWorkspace);
              if (blocks) projected.arduinoBlocks = blocks;
            }
            return { ...component, stateProperties: projected };
          }
          return component;
        });
        if (simulationComponents.some((c) => c === null)) return validated.artifact;
        const simulation = validatePublicProjectDisplayArtifact({
          ...candidate,
          schemaVersion: 3,
          status: 'simulation',
          solverIterations: source.simulation?.maxIterations,
          components: simulationComponents,
        });
        return simulation.ok ? simulation.artifact : validated.artifact;
      },
    ],
  ]);
}
function fallback(source: Source): PublicProjectDisplayArtifact {
  const family = ['electronics', 'three-d', 'blocks'].includes(source.module_key)
    ? source.module_key
    : null;
  return {
    schemaVersion: 1,
    provenance: {
      publicationId: source.publication_id,
      revisionNumber: Number(source.revision_no),
    },
    capabilities: { readOnly: true, interactive: false, download: false },
    ...(family
      ? {
          status: 'static-only',
          viewerFamily: family as 'electronics' | 'three-d' | 'blocks',
          reason: 'viewer-not-available',
        }
      : { status: 'unsupported', viewerFamily: null, reason: 'unsupported-module' }),
  };
}
/** Per-controller bounded cache contains ONLY validated public projections. No raw source persists. */
export class PublicArtifactService {
  private readonly cache = new Map<
    string,
    { artifact: PublicProjectDisplayArtifact; bytes: number }
  >();
  private bytes = 0;
  private active = 0;
  private readonly waiting: Array<{ grant: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  private acquire(): Promise<void> {
    if (this.active < 8) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= 64)
      return Promise.reject(
        publicationError('database_unavailable', 'Просмотр временно недоступен.', 503),
      );
    return new Promise((resolve, reject) => {
      const entry = {
        grant: resolve,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(publicationError('database_unavailable', 'Просмотр временно недоступен.', 503));
        }, 5000),
      };
      this.waiting.push(entry);
    });
  }
  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.grant();
    } else this.active--;
  }
  private readonly adapters: ReadonlyMap<string, Adapter>;
  constructor(registry: ModuleRegistry) {
    this.adapters = createPublicArtifactAdapters(registry);
  }
  async read(
    pool: pg.Pool,
    publicationId: string,
    revisionId: string,
  ): Promise<PublicProjectDisplayArtifact> {
    await this.acquire();
    try {
      // Always freshly authorize exact current immutable revision, including cache hits.
      const result = await pool.query<Source>(
        'SELECT * FROM public.public_project_artifact_document($1,$2)',
        [publicationId, revisionId],
      );
      const source = result.rows[0];
      if (!source) throw publicationError('not_available', 'Публикация недоступна.', 404);
      if (source.publication_id !== publicationId || source.revision_id !== revisionId)
        throw publicationError('not_available', 'Публикация недоступна.', 404);
      const key = publicationId + ':' + revisionId;
      const hit = this.cache.get(key);
      if (hit) return hit.artifact;
      let artifact: PublicProjectDisplayArtifact = fallback(source);
      try {
        artifact =
          this.adapters.get(source.module_key)?.(source.document_json, {
            publicationId,
            revisionNumber: Number(source.revision_no),
          }) ?? artifact;
      } catch {
        /* Safe cover fallback; never expose parser input/errors. */
      }
      const validated = validatePublicProjectDisplayArtifact(artifact);
      if (!validated.ok) throw publicationError('not_available', 'Публикация недоступна.', 404);
      const bytes = Buffer.byteLength(JSON.stringify(validated.artifact));
      while (this.cache.size >= 32 || this.bytes + bytes > 4194304) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.bytes -= this.cache.get(oldest)!.bytes;
        this.cache.delete(oldest);
      }
      this.cache.set(key, { artifact: validated.artifact, bytes });
      this.bytes += bytes;
      return validated.artifact;
    } finally {
      this.release();
    }
  }
}
