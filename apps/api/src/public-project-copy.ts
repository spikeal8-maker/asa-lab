import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type pg from 'pg';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import { previewDigest } from '@asa-lab/module-sdk';
import { PgProjectRepository, type ProjectPreview } from '@asa-lab/projects';
import { publicationError } from './public-projects.errors.js';
import { validationMessage } from './validation.js';

export function publicProjectCopySupported(moduleKey: string, license: string): boolean {
  return license === 'public-domain' && (moduleKey === 'three-d' || moduleKey === 'electronics');
}

// 3D's parser preserves extension fields. Do not transport unknown extensions:
// future assets/imports need their own copy policy before crossing tenant RLS.
const THREE_D_KEYS = new Set([
  'schemaVersion',
  'units',
  'nodes',
  'grid',
  'camera',
  'ruler',
  'id',
  'kind',
  'primitive',
  'name',
  'operation',
  'color',
  'opacity',
  'transform',
  'dimensions',
  'sides',
  'bevel',
  'parameters',
  'visible',
  'locked',
  'bundleId',
  'groupId',
  'groupOperation',
  'position',
  'rotation',
  'scale',
  'x',
  'y',
  'z',
  'width',
  'depth',
  'height',
  'snap',
  'target',
  'projection',
  'origin',
  'precision',
  'topRadius',
  'baseRadius',
  'innerRadius',
  'text',
  'font',
  'curveAngle',
  'bevelSegments',
  'radius',
  'tubeRadius',
  'wallThickness',
  'steps',
  'points',
  'innerRatio',
  'fontSize',
  'segments',
  'topScale',
  'baseScale',
  'twist',
  'twistSteps',
  'smoothTwist',
  'sketchPoints',
  'sketchAccepted',
]);
function hasOnlyPortableThreeDFields(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(hasOnlyPortableThreeDFields);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).every(
      ([key, nested]) => THREE_D_KEYS.has(key) && hasOnlyPortableThreeDFields(nested),
    );
  }
  return true;
}

export function validatePublicCopyDocument(
  registry: ModuleRegistry,
  moduleKey: string,
  document: unknown,
): { readonly document: unknown; readonly preview: ProjectPreview | null } {
  const entry = registry.get(moduleKey);
  if (!entry?.provider || !publicProjectCopySupported(moduleKey, 'public-domain')) {
    throw publicationError('copy_forbidden', 'Этот тип проекта пока нельзя копировать.', 403);
  }
  const parsed = validationMessage(entry, document);
  // Preserve exact immutable JSON, never a lossy migration or source exporter.
  // Electronics' canonical parser reconstructs every supported inline field;
  // equality therefore also rejects unknown asset/tenant extensions.
  if (
    !parsed.ok ||
    !isDeepStrictEqual(parsed.document, document) ||
    (moduleKey === 'three-d' && !hasOnlyPortableThreeDFields(document))
  ) {
    throw publicationError(
      'copy_unsupported',
      'Содержимое этой версии пока нельзя перенести целиком.',
      403,
    );
  }
  const descriptor = entry.provider.createPreview(parsed.document);
  return {
    document,
    preview: descriptor ? { descriptor, digest: previewDigest(descriptor) } : null,
  };
}

interface PublicCopyReference {
  readonly publication_id: string;
  readonly revision_id: string;
  readonly module_key: string;
  readonly license: string;
}

/** Internal document projection is consumed here and never attached to a public DTO. */
export async function readPublicCopyAdmission(
  pool: pg.Pool,
  registry: ModuleRegistry,
  publications: readonly PublicCopyReference[],
): Promise<ReadonlySet<string>> {
  const admitted = new Set<string>();
  // One batch for the visible page only; do not fetch the pagination sentinel.
  if (publications.length > 48) throw new Error('public copy admission page exceeds limit');
  const candidates = publications.filter((row) =>
    publicProjectCopySupported(row.module_key, row.license),
  );
  if (candidates.length === 0) return admitted;
  const expected = new Map(candidates.map((row) => [row.publication_id, row]));
  const result = await pool.query<PublicCopyReference & { document_json: unknown }>(
    'SELECT * FROM public_project_copy_documents($1::uuid[],$2::uuid[])',
    [candidates.map((row) => row.publication_id), candidates.map((row) => row.revision_id)],
  );
  for (const source of result.rows) {
    const reference = expected.get(source.publication_id);
    if (
      !reference ||
      reference.revision_id !== source.revision_id ||
      reference.module_key !== source.module_key ||
      reference.license !== source.license
    )
      continue;
    try {
      // Exactly the POST admission, including parser equality and portability.
      validatePublicCopyDocument(registry, source.module_key, source.document_json);
      admitted.add(source.publication_id);
    } catch {
      // A document/provider failure cannot advertise an unusable copy action.
    }
  }
  return admitted;
}

interface CopySource {
  destination_tenant_id: string;
  destination_user_id: string | null;
  source_project_id: string;
  publication_id: string;
  revision_id: string;
  version_id: string;
  module_key: string;
  title: string;
  author_label: string;
  license: 'public-domain';
  document_json: unknown;
}

/** One transaction retains source locks through Project + Draft + receipt insertion. */
export async function copyPublicProject(input: {
  pool: pg.Pool;
  registry: ModuleRegistry;
  principalId: string;
  publicationId: string;
  revisionId: string;
  title?: string;
  idempotencyKey: string;
}) {
  const client = await input.pool.connect();
  try {
    await client.query('BEGIN');
    // Source is checked even on replay: after revoke the response is 404 and
    // the already committed private copy is retained. No fresh source is read.
    const result = await client.query<CopySource>(
      'SELECT * FROM public_project_copy_source($1,$2,$3)',
      [input.principalId, input.publicationId, input.revisionId],
    );
    const source = result.rows[0];
    if (!source) throw publicationError('not_available', 'Публикация недоступна.', 404);
    if (!publicProjectCopySupported(source.module_key, source.license)) {
      throw publicationError('copy_forbidden', 'Копирование этой публикации запрещено.', 403);
    }
    const validated = validatePublicCopyDocument(
      input.registry,
      source.module_key,
      source.document_json,
    );
    const title = input.title ?? source.title;
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          operation: 'public-project-copy-v1',
          actor: input.principalId,
          publication: input.publicationId,
          revision: input.revisionId,
          title,
        }),
      )
      .digest('hex');
    const created = await new PgProjectRepository(input.pool)
      .inTransaction(client)
      .createWithDraft({
        tenantId: source.destination_tenant_id,
        scope: 'personal',
        classroomId: null,
        actor: { principalId: input.principalId, userId: source.destination_user_id },
        moduleKey: source.module_key,
        title,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        initialDocument: validated.document,
        initialPreview: validated.preview,
        publicationCopyOrigin: {
          projectId: source.source_project_id,
          publicationId: source.publication_id,
          revisionId: source.revision_id,
          versionId: source.version_id,
          title: source.title,
          author: source.author_label,
          license: source.license,
        },
      });
    if (created.kind === 'conflict') {
      throw publicationError(
        'idempotency_conflict',
        'Этот ключ уже использован для другого запроса.',
        409,
      );
    }
    if (created.kind === 'classroom_not_found') {
      throw publicationError('copy_forbidden', 'Личное пространство недоступно.', 403);
    }
    await client.query('COMMIT');
    return {
      projectId: created.project.id,
      moduleKey: created.project.moduleKey,
      created: created.kind === 'created',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
