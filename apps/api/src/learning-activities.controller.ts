import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { effectiveAccountActions } from '@asa-lab/identity';
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

type SafeTaskBlock =
  | { type: 'heading' | 'paragraph' | 'callout'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'link'; text: string; href: string }
  | { type: 'image'; alt: string; contentHash: string; src?: string };

function safeTaskBlocks(value: unknown): value is SafeTaskBlock[] {
  if (!Array.isArray(value) || value.length > 32) return false;
  if (
    value.filter((item: unknown) => (item as Record<string, unknown> | null)?.['type'] === 'image')
      .length > 1
  )
    return false;
  return value.every((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const block = item as Record<string, unknown>;
    const type = block['type'];
    if (type === 'image') {
      return (
        Object.keys(block).every((key) => ['type', 'alt', 'contentHash'].includes(key)) &&
        typeof block['alt'] === 'string' &&
        block['alt'].trim().length >= 1 &&
        block['alt'].trim().length <= 160 &&
        typeof block['contentHash'] === 'string' &&
        /^[0-9a-f]{64}$/.test(block['contentHash'])
      );
    }
    if (type === 'list') {
      return (
        Object.keys(block).every((key) => ['type', 'items'].includes(key)) &&
        Array.isArray(block['items']) &&
        block['items'].length >= 1 &&
        block['items'].length <= 20 &&
        block['items'].every(
          (text: unknown) =>
            typeof text === 'string' && text.trim().length >= 1 && text.trim().length <= 500,
        )
      );
    }
    if (!['heading', 'paragraph', 'callout', 'link'].includes(String(type))) return false;
    if (
      typeof block['text'] !== 'string' ||
      !block['text'].trim() ||
      block['text'].length > (type === 'heading' || type === 'link' ? 160 : 12000) ||
      !Object.keys(block).every((key) =>
        type === 'link' ? ['type', 'text', 'href'].includes(key) : ['type', 'text'].includes(key),
      )
    )
      return false;
    if (type !== 'link') return true;
    if (
      typeof block['href'] !== 'string' ||
      block['href'].length > 2048 ||
      /\s/.test(block['href'])
    )
      return false;
    try {
      const url = new URL(block['href']);
      return (url.protocol === 'https:' || url.protocol === 'http:') && !!url.hostname;
    } catch {
      return false;
    }
  });
}

function error(code: string, message: string) {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function decodeDraftImage(raw: string): { bytes: Buffer; contentType: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if (!match) {
    throw new HttpException(error('validation_error', 'Подойдёт PNG, JPEG или WebP.'), 400);
  }
  const bytes = Buffer.from(match[2] as string, 'base64');
  if (bytes.byteLength < 1 || bytes.byteLength > 400_000) {
    throw new HttpException(error('validation_error', 'Картинка должна быть до 400 КБ.'), 400);
  }
  return { bytes, contentType: match[1] as string };
}

type DraftInput = {
  kind: string;
  title: string;
  goal: string | null | undefined;
  blocks: SafeTaskBlock[] | undefined;
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
    @Inject(TOKENS.moduleRegistry) private readonly modules: ModuleRegistry,
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
    const [capabilities, workspaces] = await Promise.all([
      this.accounts.capabilities(context.accountId),
      this.accounts.workspaces(context.accountId),
    ]);
    if (
      !effectiveAccountActions(context, capabilities, workspaces).includes('content.create.own')
    ) {
      throw new HttpException(
        error('author_required', 'Подключите создание материалов в разделе «Возможности».'),
        403,
      );
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
      'goal',
      'blocks',
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
    const goal = shape.body['goal'];
    const blocks = shape.body['blocks'];
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
      (goal !== undefined &&
        goal !== null &&
        (typeof goal !== 'string' || goal.trim().length > 160)) ||
      (blocks !== undefined && !safeTaskBlocks(blocks)) ||
      (Array.isArray(blocks) &&
        typeof instructions === 'string' &&
        instructions.trim().length > 0 &&
        blocks.length > 31) ||
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
      (typeof moduleKey === 'string' &&
        !this.modules.listLearningAssignable().some((module) => module.moduleKey === moduleKey)) ||
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
      goal: typeof goal === 'string' ? goal.trim() || null : goal,
      blocks: blocks as SafeTaskBlock[] | undefined,
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

  private draftSampleError(code: string | undefined): HttpException {
    const status =
      code === 'invalid_media' || code === 'invalid_draft'
        ? 400
        : code === 'revision_conflict'
          ? 409
          : 404;
    const message =
      code === 'sample_not_found'
        ? 'Картинки нет.'
        : code === 'revision_conflict'
          ? 'Черновик изменён в другом окне.'
          : code === 'invalid_media'
            ? 'Подойдёт PNG, JPEG или WebP до 400 КБ.'
            : code === 'invalid_draft'
              ? 'В содержании слишком много блоков для изображения.'
              : 'Материал недоступен.';
    return new HttpException(error(code ?? 'draft_sample_failed', message), status);
  }

  private draftSampleUrl(activityId: string, contentHash: string): string {
    return `/api/learning/activities/${encodeURIComponent(activityId)}/draft-sample?v=${encodeURIComponent(contentHash)}`;
  }

  private versionSampleUrl(activityId: string, versionId: string, contentHash: string): string {
    return `/api/learning/activities/${encodeURIComponent(activityId)}/versions/${encodeURIComponent(versionId)}/sample?v=${encodeURIComponent(contentHash)}`;
  }

  private draftTaskImageUrl(activityId: string, contentHash: string): string {
    return `/api/learning/activities/${encodeURIComponent(activityId)}/draft-task-image?v=${encodeURIComponent(contentHash)}`;
  }

  private versionTaskImageUrl(activityId: string, versionId: string, contentHash: string): string {
    return `/api/learning/activities/${encodeURIComponent(activityId)}/versions/${encodeURIComponent(versionId)}/task-image?v=${encodeURIComponent(contentHash)}`;
  }

  private versionSampleError(code: string | undefined): HttpException {
    const message = code === 'sample_not_found' ? 'Картинки нет.' : 'Версия недоступна.';
    return new HttpException(error(code ?? 'version_sample_failed', message), 404);
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
    // A personal author cannot relabel a private draft as school-owned or
    // import teacher-only evidence through a client-supplied source UUID.
    if (
      context.workspaceKind === 'personal' &&
      (scope !== 'personal' || visibility !== 'private')
    ) {
      throw new HttpException(error('scope_forbidden', 'Личный материал остаётся личным.'), 403);
    }
    if (sourceTeacherAssignmentId !== null) {
      const capabilities = await this.accounts.capabilities(context.accountId);
      if (
        !capabilities.some(
          (entry) =>
            entry.capability === 'educator' && ['verified', 'provisional'].includes(entry.state),
        )
      ) {
        throw new HttpException(error('source_forbidden', 'Источник недоступен.'), 403);
      }
    }
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
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb
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
        draft.goal === undefined ? null : JSON.stringify(draft.goal),
        draft.blocks === undefined ? null : JSON.stringify(draft.blocks),
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
    const pool = this.requirePool();
    const result = await pool.query(
      `SELECT activity_id, tenant_id, title, kind, owner_scope, visibility_policy,
              draft_revision, draft_payload, current_published_version_id, archived_at
         FROM learning_activity_get($1, $2, $3)`,
      [context.principalId, context.tenantId, activityId],
    );
    const row = result.rows[0];
    if (!row) throw this.resultError('activity_not_found');
    const draftPayload = row['draft_payload'] as Record<string, unknown>;
    let inheritedGoal: string | null = null;
    if (!Object.prototype.hasOwnProperty.call(draftPayload, 'goal')) {
      // The author-only preview resolves a legacy teacher source without
      // changing the stored draft's omitted-goal semantics.
      const resolved = await pool.query(
        `SELECT result_code, goal
           FROM learning_activity_preview_with_goal_as_author($1,$2,$3,'draft',NULL,$4)`,
        [context.principalId, context.tenantId, activityId, Number(row['draft_revision'])],
      );
      if (resolved.rows[0]?.['result_code'] === 'ok') {
        inheritedGoal = (resolved.rows[0]['goal'] as string | null) ?? null;
      }
    }
    const sample = await pool.query(
      `SELECT result_code, content_hash
         FROM learning_activity_draft_sample_meta($1,$2,$3,NULL)`,
      [context.principalId, context.tenantId, activityId],
    );
    const sampleRow = sample.rows[0];
    const sampleCode = sampleRow?.['result_code'] as string | undefined;
    if (
      sampleCode !== 'ok' &&
      sampleCode !== 'sample_not_found' &&
      sampleCode !== 'activity_not_found'
    ) {
      throw this.draftSampleError(sampleCode);
    }
    return {
      id: String(row['activity_id']),
      tenantId: String(row['tenant_id']),
      title: String(row['title']),
      kind: String(row['kind']),
      ownerScope: String(row['owner_scope']),
      visibility: String(row['visibility_policy']),
      draftRevision: Number(row['draft_revision']),
      draft: draftPayload,
      inheritedGoal,
      draftSampleImage:
        sampleCode === 'ok' && sampleRow?.['content_hash']
          ? this.draftSampleUrl(activityId, String(sampleRow['content_hash']))
          : null,
      currentPublishedVersionId: row['current_published_version_id']
        ? String(row['current_published_version_id'])
        : null,
      archivedAt: row['archived_at'] ? iso(row['archived_at'] as Date | string) : null,
    };
  }

  @Get(':activityId/draft-sample')
  async getDraftSample(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    const result = await this.requirePool().query(
      `SELECT result_code, content_type, bytes, content_hash, draft_revision
         FROM learning_activity_draft_sample_get($1,$2,$3)`,
      [context.principalId, context.tenantId, activityId],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok' || !row['bytes']) {
      throw this.draftSampleError(row?.['result_code'] as string | undefined);
    }
    return reply
      .header('content-type', String(row['content_type']))
      .header('cache-control', 'private, no-store')
      .header('etag', `"${String(row['content_hash'])}"`)
      .send(row['bytes'] as Buffer);
  }

  @Get(':activityId/draft-task-image')
  async getDraftTaskImage(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Query('v') contentHash: string | undefined,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    if (!contentHash || !/^[0-9a-f]{64}$/.test(contentHash))
      throw new HttpException(error('validation_error', 'image hash is invalid'), 400);
    const result = await this.requirePool().query(
      `SELECT result_code, content_type, bytes, content_hash
         FROM learning_activity_draft_task_image_get($1,$2,$3)`,
      [context.principalId, context.tenantId, activityId],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok' || !row['bytes'])
      throw this.draftSampleError(row?.['result_code'] as string | undefined);
    if (row['content_hash'] !== contentHash)
      throw new HttpException(error('image_not_found', 'Изображение недоступно.'), 404);
    return reply
      .header('content-type', String(row['content_type']))
      .header('cache-control', 'private, no-store')
      .header('etag', `"${String(row['content_hash'])}"`)
      .send(row['bytes'] as Buffer);
  }

  @Put(':activityId/draft-task-image')
  async putDraftTaskImage(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    const shape = checkBodyShape(rawBody, ['imageDataUrl', 'expectedRevision']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const revision = shape.body['expectedRevision'];
    if (
      typeof shape.body['imageDataUrl'] !== 'string' ||
      !Number.isSafeInteger(revision) ||
      Number(revision) < 1 ||
      Number(revision) > 2147483647
    )
      throw new HttpException(error('validation_error', 'Проверьте изображение и редакцию.'), 400);
    const image = decodeDraftImage(shape.body['imageDataUrl']);
    const result = await this.requirePool().query(
      `SELECT result_code, draft_revision, content_hash
         FROM learning_activity_draft_task_image_set($1,$2,$3,$4,$5,$6)`,
      [
        context.principalId,
        context.tenantId,
        activityId,
        Number(revision),
        image.bytes,
        image.contentType,
      ],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok' || !row['content_hash'])
      throw this.draftSampleError(row?.['result_code'] as string | undefined);
    return {
      draftRevision: Number(row['draft_revision']),
      contentHash: String(row['content_hash']),
      url: this.draftTaskImageUrl(activityId, String(row['content_hash'])),
    };
  }

  @Put(':activityId/draft-sample')
  async putDraftSample(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    const shape = checkBodyShape(rawBody, ['imageDataUrl', 'expectedRevision']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const imageDataUrl = shape.body['imageDataUrl'];
    const expectedRevision = shape.body['expectedRevision'];
    if (
      typeof imageDataUrl !== 'string' ||
      !Number.isSafeInteger(expectedRevision) ||
      Number(expectedRevision) < 1 ||
      Number(expectedRevision) > 2147483647
    ) {
      throw new HttpException(error('validation_error', 'Проверьте изображение и редакцию.'), 400);
    }
    const image = decodeDraftImage(imageDataUrl);
    const result = await this.requirePool().query(
      `SELECT result_code, draft_revision, content_hash
         FROM learning_activity_draft_sample_set($1,$2,$3,$4,$5,$6)`,
      [
        context.principalId,
        context.tenantId,
        activityId,
        Number(expectedRevision),
        image.bytes,
        image.contentType,
      ],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok' || !row['content_hash']) {
      throw this.draftSampleError(row?.['result_code'] as string | undefined);
    }
    return {
      draftRevision: Number(row['draft_revision']),
      contentHash: String(row['content_hash']),
      url: this.draftSampleUrl(activityId, String(row['content_hash'])),
    };
  }

  @Delete(':activityId/draft-sample')
  async deleteDraftSample(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    const shape = checkBodyShape(rawBody, ['expectedRevision']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const expectedRevision = shape.body['expectedRevision'];
    if (
      !Number.isSafeInteger(expectedRevision) ||
      Number(expectedRevision) < 1 ||
      Number(expectedRevision) > 2147483647
    ) {
      throw new HttpException(error('validation_error', 'Проверьте редакцию.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT result_code, draft_revision
         FROM learning_activity_draft_sample_delete($1,$2,$3,$4)`,
      [context.principalId, context.tenantId, activityId, Number(expectedRevision)],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok') {
      throw this.draftSampleError(row?.['result_code'] as string | undefined);
    }
    return { draftRevision: Number(row['draft_revision']) };
  }

  @Get(':activityId/versions/:versionId/sample')
  async getVersionSample(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Param('versionId') versionId: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    this.requireUuid(versionId, 'version');
    const result = await this.requirePool().query(
      `SELECT result_code, content_type, bytes, content_hash
         FROM learning_activity_version_sample_get($1,$2,$3,$4)`,
      [context.principalId, context.tenantId, activityId, versionId],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok' || !row['bytes']) {
      throw this.versionSampleError(row?.['result_code'] as string | undefined);
    }
    return reply
      .header('content-type', String(row['content_type']))
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('etag', `"${String(row['content_hash'])}"`)
      .send(row['bytes'] as Buffer);
  }

  @Get(':activityId/versions/:versionId/task-image')
  async getVersionTaskImage(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Param('versionId') versionId: string,
    @Query('v') contentHash: string | undefined,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    this.requireUuid(versionId, 'version');
    if (!contentHash || !/^[0-9a-f]{64}$/.test(contentHash))
      throw new HttpException(error('validation_error', 'image hash is invalid'), 400);
    const result = await this.requirePool().query(
      `SELECT result_code, content_type, bytes, content_hash
         FROM learning_activity_version_task_image_get($1,$2,$3,$4)`,
      [context.principalId, context.tenantId, activityId, versionId],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok' || !row['bytes'])
      throw this.versionSampleError(row?.['result_code'] as string | undefined);
    if (row['content_hash'] !== contentHash)
      throw new HttpException(error('image_not_found', 'Изображение недоступно.'), 404);
    return reply
      .header('content-type', String(row['content_type']))
      .header('cache-control', 'private, no-store')
      .header('etag', `"${String(row['content_hash'])}"`)
      .send(row['bytes'] as Buffer);
  }

  @Get(':activityId/preview')
  async previewAsLearner(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Query('source') source: string | undefined,
    @Query('draftRevision') draftRevisionRaw: string | undefined,
    @Query('versionId') versionIdRaw: string | undefined,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    let versionId: string | null = null;
    let draftRevision: number | null = null;
    if (source === 'draft') {
      draftRevision = Number(draftRevisionRaw);
      if (
        !/^[1-9]\d*$/.test(draftRevisionRaw ?? '') ||
        !Number.isSafeInteger(draftRevision) ||
        draftRevision > 2147483647 ||
        versionIdRaw !== undefined
      ) {
        throw new HttpException(error('validation_error', 'preview source is invalid'), 400);
      }
    } else if (source === 'published') {
      if (!versionIdRaw || !UUID_PATTERN.test(versionIdRaw) || draftRevisionRaw !== undefined) {
        throw new HttpException(error('validation_error', 'preview source is invalid'), 400);
      }
      versionId = versionIdRaw;
    } else {
      throw new HttpException(error('validation_error', 'preview source is invalid'), 400);
    }
    const pool = this.requirePool();
    const result = await pool.query(
      `SELECT result_code,activity_id,source_kind,source_id,draft_revision,version_number,
              title,instructions,module_key,result_mode,max_points,policy_snapshot,content_digest,goal
         FROM learning_activity_preview_with_goal_as_author($1,$2,$3,$4,$5,$6)`,
      [context.principalId, context.tenantId, activityId, source, versionId, draftRevision],
    );
    const row = result.rows[0];
    const code = row?.['result_code'] as string | undefined;
    if (code === 'revision_conflict') {
      throw new HttpException(
        error('preview_revision_conflict', 'saved draft revision changed'),
        409,
      );
    }
    if (code === 'activity_not_found' || code === 'version_not_found') {
      throw new HttpException(error(code, 'preview source is unavailable'), 404);
    }
    if (!row || code !== 'ok') {
      throw new HttpException(error(code ?? 'preview_failed', 'preview source is invalid'), 400);
    }
    const blockResult = await pool.query(
      `SELECT result_code, blocks FROM learning_activity_blocks_preview_as_author($1,$2,$3,$4,$5,$6)`,
      [context.principalId, context.tenantId, activityId, source, versionId, draftRevision],
    );
    const blockRow = blockResult.rows[0];
    if (blockRow?.['result_code'] === 'revision_conflict') {
      throw new HttpException(
        error('preview_revision_conflict', 'saved draft revision changed'),
        409,
      );
    }
    if (blockRow?.['result_code'] !== 'ok' || !safeTaskBlocks(blockRow['blocks'])) {
      throw new HttpException(error('preview_failed', 'task blocks are unavailable'), 409);
    }
    let sampleImage: string | null = null;
    if (source === 'draft') {
      const sample = await pool.query(
        `SELECT result_code, content_hash, draft_revision
           FROM learning_activity_draft_sample_meta($1,$2,$3,$4)`,
        [context.principalId, context.tenantId, activityId, Number(row['draft_revision'])],
      );
      const sampleRow = sample.rows[0];
      const sampleCode = sampleRow?.['result_code'] as string | undefined;
      if (sampleCode === 'revision_conflict') {
        throw new HttpException(
          error('preview_revision_conflict', 'saved draft revision changed'),
          409,
        );
      }
      if (sampleCode === 'ok' && sampleRow?.['content_hash']) {
        sampleImage = this.draftSampleUrl(activityId, String(sampleRow['content_hash']));
      } else if (sampleCode !== 'sample_not_found' && sampleCode !== 'activity_not_found') {
        throw this.draftSampleError(sampleCode);
      }
    } else {
      const sample = await pool.query(
        `SELECT result_code, content_hash
           FROM learning_activity_version_sample_meta($1,$2,$3,$4)`,
        [context.principalId, context.tenantId, activityId, versionId],
      );
      const sampleRow = sample.rows[0];
      const sampleCode = sampleRow?.['result_code'] as string | undefined;
      if (sampleCode === 'ok' && sampleRow?.['content_hash']) {
        sampleImage = this.versionSampleUrl(
          activityId,
          versionId!,
          String(sampleRow['content_hash']),
        );
      } else if (sampleCode !== 'sample_not_found') {
        throw this.versionSampleError(sampleCode);
      }
    }

    return {
      source: {
        kind: String(row['source_kind']) as 'draft' | 'published',
        id: row['source_id'] ? String(row['source_id']) : null,
        draftRevision:
          row['draft_revision'] === null || row['draft_revision'] === undefined
            ? null
            : Number(row['draft_revision']),
        versionNumber:
          row['version_number'] === null || row['version_number'] === undefined
            ? null
            : Number(row['version_number']),
        contentDigest: String(row['content_digest']),
      },
      assignment: {
        title: String(row['title']),
        goal: row['goal'] == null ? null : String(row['goal']),
        brief: row['instructions'] === null ? null : String(row['instructions']),
        blocks: (blockRow['blocks'] as SafeTaskBlock[]).map((block) =>
          block.type === 'image'
            ? {
                ...block,
                src:
                  source === 'draft'
                    ? this.draftTaskImageUrl(activityId, block.contentHash)
                    : this.versionTaskImageUrl(activityId, versionId!, block.contentHash),
              }
            : block,
        ),
        sampleImage,
      },
      moduleKey: row['module_key'] === null ? null : String(row['module_key']),
      resultMode: String(row['result_mode']) as 'ungraded' | 'completion' | 'graded',
      maxPoints: row['max_points'] === null ? null : Number(row['max_points']),
      policies: row['policy_snapshot'] as Record<string, unknown>,
      learnerRuntime: false as const,
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
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14::jsonb
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
        draft.goal === undefined ? null : JSON.stringify(draft.goal),
        draft.blocks === undefined ? null : JSON.stringify(draft.blocks),
      ],
    );
    const row = result.rows[0];
    if (!row || row['result_code'] !== 'ok') {
      throw this.resultError(row?.['result_code'] as string | undefined);
    }
    return { id: activityId, draftRevision: Number(row['draft_revision']) };
  }

  @Post(':activityId/versions/:versionId/draft')
  async draftFromVersion(
    @Req() request: FastifyRequest,
    @Param('activityId') activityId: string,
    @Param('versionId') versionId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(activityId, 'activity');
    this.requireUuid(versionId, 'version');
    const shape = checkBodyShape(rawBody, ['expectedRevision']);
    if (
      !shape.ok ||
      !Number.isSafeInteger(shape.body['expectedRevision']) ||
      Number(shape.body['expectedRevision']) < 1 ||
      Number(shape.body['expectedRevision']) > 2147483647
    )
      throw new HttpException(error('validation_error', 'Укажите текущую редакцию.'), 400);
    const result = await this.requirePool().query(
      'SELECT * FROM learning_activity_draft_from_version($1,$2,$3,$4,$5)',
      [
        context.principalId,
        context.tenantId,
        activityId,
        versionId,
        shape.body['expectedRevision'],
      ],
    );
    const row = result.rows[0];
    if (row?.['result_code'] !== 'ok')
      throw new HttpException(
        error(
          row?.['result_code'] ?? 'draft_failed',
          row?.['result_code'] === 'draft_exists'
            ? 'Уже существует черновик. Откройте его для продолжения.'
            : 'Черновик не создан. Обновите материал.',
        ),
        row?.['result_code']?.endsWith('_not_found') ? 404 : 409,
      );
    return {
      id: activityId,
      draftRevision: Number(row['draft_revision']),
      sourceVersionNumber: Number(row['source_version_number']),
    };
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
      `SELECT versions.*, preview.title, preview.instructions, preview.module_key, preview.goal
         FROM learning_activity_version_list($1,$2,$3) versions
         CROSS JOIN LATERAL learning_activity_preview_with_goal_as_author($1,$2,$3,'published',versions.activity_version_id,NULL) preview`,
      [context.principalId, context.tenantId, activityId],
    );
    return {
      items: result.rows.map((row) => ({
        id: String(row['activity_version_id']),
        versionNumber: Number(row['version_number']),
        title: row['title'],
        instructions: row['instructions'],
        goal: row['goal'] == null ? null : String(row['goal']),
        moduleKey: row['module_key'],
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
