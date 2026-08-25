import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(['quiz', 'project', 'essay', 'file', 'manual']);
const RESULT_MODES = new Set(['ungraded', 'completion', 'graded']);
const POLICY_KEYS = [
  'attemptPolicy',
  'resultSelectionPolicy',
  'completionPolicy',
  'latePolicy',
  'assessmentPolicy',
  'feedbackReleasePolicy',
] as const;

function error(code: string, message: string) {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type DraftInput = {
  kind: string;
  title: string;
  instructions: string | null;
  resultMode: string;
  maxPoints: number | null;
  policies: Record<string, unknown>;
  moduleKey: string | null;
  quizVersionId: string | null;
  starterProjectVersionId: string | null;
};

@Controller('api/learning/activities')
export class LearningActivitiesController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool) {
      throw new HttpException(error('database_unavailable', 'database is not configured'), 503);
    }
    return this.pool;
  }

  private async requireEducator(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(error('educator_required', 'Доступно только педагогам.'), 403);
    }
    return context;
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  private draft(rawBody: unknown, includeKind: boolean): DraftInput {
    const keys = [
      ...(includeKind ? ['kind'] : []),
      'title',
      'instructions',
      'resultMode',
      'maxPoints',
      'policies',
      'moduleKey',
      'quizVersionId',
      'starterProjectVersionId',
      ...(includeKind ? ['scope', 'visibility', 'sourceTeacherAssignmentId'] : []),
      ...(includeKind ? ['requestId'] : []),
      ...(!includeKind ? ['expectedRevision'] : []),
    ];
    const shape = checkBodyShape(rawBody, keys);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const kind = includeKind ? shape.body['kind'] : (shape.body['kind'] ?? '');
    const title = shape.body['title'];
    const instructions = shape.body['instructions'] ?? null;
    const resultMode = shape.body['resultMode'];
    const maxPoints = shape.body['maxPoints'] ?? null;
    const policies = shape.body['policies'];
    const moduleKey = shape.body['moduleKey'] ?? null;
    const quizVersionId = shape.body['quizVersionId'] ?? null;
    const starterProjectVersionId = shape.body['starterProjectVersionId'] ?? null;
    if (
      (includeKind && (typeof kind !== 'string' || !KINDS.has(kind))) ||
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 255 ||
      (instructions !== null &&
        (typeof instructions !== 'string' || instructions.length > 12000)) ||
      typeof resultMode !== 'string' ||
      !RESULT_MODES.has(resultMode) ||
      (maxPoints !== null &&
        (typeof maxPoints !== 'number' || !Number.isInteger(maxPoints) || maxPoints <= 0)) ||
      (resultMode === 'graded' && maxPoints === null) ||
      (resultMode !== 'graded' && maxPoints !== null) ||
      !policies ||
      typeof policies !== 'object' ||
      Array.isArray(policies) ||
      POLICY_KEYS.some((key) => !(key in (policies as Record<string, unknown>))) ||
      Object.keys(policies as Record<string, unknown>).some(
        (key) => !POLICY_KEYS.includes(key as (typeof POLICY_KEYS)[number]),
      ) ||
      POLICY_KEYS.some((key) => {
        const value = (policies as Record<string, unknown>)[key];
        return value !== null && (typeof value !== 'object' || Array.isArray(value));
      }) ||
      (moduleKey !== null &&
        (typeof moduleKey !== 'string' || !/^[a-z0-9-]{1,64}$/.test(moduleKey))) ||
      (quizVersionId !== null &&
        (typeof quizVersionId !== 'string' || !UUID_PATTERN.test(quizVersionId))) ||
      (starterProjectVersionId !== null &&
        (typeof starterProjectVersionId !== 'string' ||
          !UUID_PATTERN.test(starterProjectVersionId)))
    ) {
      throw new HttpException(error('validation_error', 'Проверьте определение активности.'), 400);
    }
    return {
      kind: String(kind),
      title: title.trim(),
      instructions,
      resultMode,
      maxPoints,
      policies: policies as Record<string, unknown>,
      moduleKey,
      quizVersionId,
      starterProjectVersionId,
    };
  }

  private resultError(code: string | undefined): HttpException {
    const status = code?.includes('forbidden') ? 403 : code === 'activity_not_found' ? 404 : 409;
    return new HttpException(
      error(code ?? 'activity_failed', 'Операция с учебной активностью не выполнена.'),
      status,
    );
  }

  @Get()
  async list(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT activity_id, title, kind, result_mode, visibility_policy,
              draft_revision, current_published_version_id, archived_at
         FROM learning_activity_list($1, $2)`,
      [context.principalId, context.tenantId],
    );
    return {
      items: result.rows.map((row) => ({
        id: String(row['activity_id']),
        title: String(row['title']),
        kind: String(row['kind']),
        resultMode: String(row['result_mode']),
        visibility: String(row['visibility_policy']),
        draftRevision: Number(row['draft_revision']),
        currentPublishedVersionId: row['current_published_version_id']
          ? String(row['current_published_version_id'])
          : null,
        archivedAt: row['archived_at'] ? iso(row['archived_at'] as Date | string) : null,
      })),
    };
  }

  @Post()
  async create(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireEducator(request);
    const draft = this.draft(rawBody, true);
    const body = rawBody as Record<string, unknown>;
    const scope = body['scope'] ?? 'personal';
    const visibility = body['visibility'] ?? 'private';
    const sourceTeacherAssignmentId = body['sourceTeacherAssignmentId'] ?? null;
    const requestId = body['requestId'];
    if (
      !['personal', 'school'].includes(String(scope)) ||
      !['private', 'school'].includes(String(visibility)) ||
      (sourceTeacherAssignmentId !== null &&
        (typeof sourceTeacherAssignmentId !== 'string' ||
          !UUID_PATTERN.test(sourceTeacherAssignmentId))) ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)
    ) {
      throw new HttpException(error('validation_error', 'Проверьте владельца активности.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT result_code, activity_id, draft_revision
         FROM learning_activity_create(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15
         )`,
      [
        context.principalId,
        context.tenantId,
        scope,
        visibility,
        draft.kind,
        draft.title,
        draft.instructions,
        draft.resultMode,
        draft.maxPoints,
        JSON.stringify(draft.policies),
        draft.moduleKey,
        draft.quizVersionId,
        draft.starterProjectVersionId,
        sourceTeacherAssignmentId,
        requestId,
      ],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok' || !row['activity_id']) {
      throw this.resultError(row?.['result_code'] as string | undefined);
    }
    return { id: String(row['activity_id']), draftRevision: Number(row['draft_revision']) };
  }

  @Get(':activityId')
  async get(@Req() request: FastifyRequest, @Param('activityId') activityId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    const result = await this.requirePool().query(
      `SELECT activity_id, tenant_id, title, kind, owner_scope, visibility_policy,
              draft_revision, draft_payload, current_published_version_id, archived_at
         FROM learning_activity_get($1, $2, $3)`,
      [context.principalId, context.tenantId, activityId],
    );
    const row = result.rows[0];
    if (!row) throw this.resultError('activity_not_found');
    return {
      id: String(row['activity_id']),
      tenantId: String(row['tenant_id']),
      title: String(row['title']),
      kind: String(row['kind']),
      ownerScope: String(row['owner_scope']),
      visibility: String(row['visibility_policy']),
      draftRevision: Number(row['draft_revision']),
      draft: row['draft_payload'],
      currentPublishedVersionId: row['current_published_version_id']
        ? String(row['current_published_version_id'])
        : null,
      archivedAt: row['archived_at'] ? iso(row['archived_at'] as Date | string) : null,
    };
  }

  @Put(':activityId/draft')
  async putDraft(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    const draft = this.draft(rawBody, false);
    const expectedRevision = (rawBody as Record<string, unknown>)['expectedRevision'];
    if (
      typeof expectedRevision !== 'number' ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 1
    ) {
      throw new HttpException(error('validation_error', 'expectedRevision is invalid'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT result_code, draft_revision
         FROM learning_activity_draft_put(
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12
         )`,
      [
        context.principalId,
        context.tenantId,
        activityId,
        expectedRevision,
        draft.title,
        draft.instructions,
        draft.resultMode,
        draft.maxPoints,
        JSON.stringify(draft.policies),
        draft.moduleKey,
        draft.quizVersionId,
        draft.starterProjectVersionId,
      ],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok') {
      throw this.resultError(row?.['result_code'] as string | undefined);
    }
    return { id: activityId, draftRevision: Number(row['draft_revision']) };
  }

  @Post(':activityId/publish')
  async publish(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    const shape = checkBodyShape(rawBody, ['expectedRevision', 'requestId']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const expectedRevision = shape.body['expectedRevision'];
    const requestId = shape.body['requestId'];
    if (
      typeof expectedRevision !== 'number' ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 1 ||
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)
    ) {
      throw new HttpException(error('validation_error', 'Проверьте параметры публикации.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT result_code, activity_version_id, version_number, content_digest, reused
         FROM learning_activity_publish($1,$2,$3,$4,$5)`,
      [context.principalId, context.tenantId, activityId, expectedRevision, requestId],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok' || !row['activity_version_id']) {
      throw this.resultError(row?.['result_code'] as string | undefined);
    }
    return {
      id: String(row['activity_version_id']),
      activityId,
      versionNumber: Number(row['version_number']),
      contentDigest: String(row['content_digest']),
      reused: row['reused'] === true,
    };
  }

  @Get(':activityId/versions')
  async versions(@Req() request: FastifyRequest, @Param('activityId') activityId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    const result = await this.requirePool().query(
      `SELECT activity_version_id, version_number, kind, result_mode, max_points,
              policy_snapshot, quiz_version_id, starter_project_version_id,
              provenance, content_digest, published_at
         FROM learning_activity_version_list($1,$2,$3)`,
      [context.principalId, context.tenantId, activityId],
    );
    return {
      items: result.rows.map((row) => ({
        id: String(row['activity_version_id']),
        versionNumber: Number(row['version_number']),
        kind: String(row['kind']),
        resultMode: String(row['result_mode']),
        maxPoints: row['max_points'] === null ? null : Number(row['max_points']),
        policies: row['policy_snapshot'],
        quizVersionId: row['quiz_version_id'] ? String(row['quiz_version_id']) : null,
        starterProjectVersionId: row['starter_project_version_id']
          ? String(row['starter_project_version_id'])
          : null,
        provenance: row['provenance'],
        contentDigest: String(row['content_digest']),
        publishedAt: iso(row['published_at'] as Date | string),
      })),
    };
  }
}
