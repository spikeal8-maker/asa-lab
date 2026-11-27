import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import { PgProjectRepository, type CreateProjectInput } from '@asa-lab/projects';
import type pg from 'pg';
import { validatePortableProjectCopyDocument } from './private-project-copy-document.js';

type CopyOrigin = NonNullable<CreateProjectInput['privateClassroomCopyOrigin']>;
export type ClassroomCopySource = CopyOrigin['source'];

interface SourceRow {
  readonly destination_tenant_id: string;
  readonly destination_user_id: string | null;
  readonly module_key: string;
  readonly title: string;
  readonly document_json: unknown;
}

async function readCopySource(
  reader: Pick<pg.PoolClient, 'query'>,
  principalId: string,
  { classroomId, projectId, seatId, source }: CopyOrigin,
) {
  const result = await reader.query<SourceRow>(
    'SELECT * FROM public.classroom_teacher_copy_source($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      principalId,
      classroomId,
      seatId,
      projectId,
      source.kind === 'free' ? source.revision : null,
      source.kind === 'submission' ? source.attemptId : null,
      source.kind === 'submission' ? source.submissionId : null,
      source.kind === 'submission' ? source.projectVersionId : null,
    ],
  );
  return result.rows[0];
}

function revisionChanged(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'P5C02';
}

export async function canCopyClassroomProject(input: {
  readonly pool: pg.Pool;
  readonly registry: ModuleRegistry;
  readonly principalId: string;
  readonly origin: CopyOrigin;
}): Promise<boolean> {
  try {
    const row = await readCopySource(input.pool, input.principalId, input.origin);
    return Boolean(
      row && validatePortableProjectCopyDocument(input.registry, row.module_key, row.document_json),
    );
  } catch (cause) {
    if (revisionChanged(cause)) return false;
    throw cause;
  }
}

function copyError(code: string, message: string, status: number): HttpException {
  return new HttpException({ error: { code, message } }, status);
}

export async function copyClassroomProject(input: {
  readonly pool: pg.Pool;
  readonly registry: ModuleRegistry;
  readonly principalId: string;
  readonly origin: CopyOrigin;
  readonly idempotencyKey: string;
}): Promise<{ readonly projectId: string; readonly moduleKey: string; readonly created: boolean }> {
  const { principalId, origin } = input;
  const client = await input.pool.connect();
  try {
    await client.query('BEGIN');
    // Check current authorization on every request, including retries.
    const row = await readCopySource(client, principalId, origin);
    if (!row) throw copyError('copy_unavailable', 'Работа недоступна для копирования.', 404);
    const portable = validatePortableProjectCopyDocument(
      input.registry,
      row.module_key,
      row.document_json,
    );
    if (!portable) {
      throw copyError(
        'copy_unsupported',
        'Эту сохранённую версию пока нельзя перенести целиком.',
        403,
      );
    }
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ operation: 'classroom-private-copy-v1', principalId, origin }))
      .digest('hex');
    const title = Array.from(row.title).slice(0, 247).join('') + ' — копия';
    const copied = await new PgProjectRepository(input.pool).inTransaction(client).createWithDraft({
      tenantId: row.destination_tenant_id,
      scope: 'personal',
      classroomId: null,
      actor: { principalId, userId: row.destination_user_id },
      moduleKey: row.module_key,
      title,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      initialDocument: portable.document,
      initialPreview: portable.preview,
      privateClassroomCopyOrigin: origin,
    });
    if (copied.kind === 'conflict') {
      throw copyError(
        'idempotency_conflict',
        'Этот ключ уже использован для другого запроса.',
        409,
      );
    }
    if (copied.kind === 'classroom_not_found') {
      throw new Error('classroom copy destination must be personal');
    }
    await client.query('COMMIT');
    return {
      projectId: copied.project.id,
      moduleKey: copied.project.moduleKey,
      created: copied.kind === 'created',
    };
  } catch (cause) {
    await client.query('ROLLBACK');
    if (revisionChanged(cause)) {
      throw copyError(
        'copy_revision_changed',
        'Работа изменилась. Откройте сохранённую версию заново.',
        409,
      );
    }
    throw cause;
  } finally {
    client.release();
  }
}
