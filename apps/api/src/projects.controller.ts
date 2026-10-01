import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type {
  ChangeProjectStatusUseCase,
  CreateCheckpointUseCase,
  RestoreVersionUseCase,
  ListVersionsUseCase,
  CreateProjectUseCase,
  DuplicateProjectUseCase,
  ListProjectsUseCase,
  OpenProjectUseCase,
  ProjectErrorCode,
  ReadProjectSnapshotUseCase,
  RenameProjectUseCase,
  SaveDraftUseCase,
  SaveProjectSnapshotUseCase,
  SuggestProjectTitleUseCase,
} from '@asa-lab/projects';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, SeatContextUseCase } from './seat-context.js';
import { FEEDBACK_BADGES, ProjectFeedbackService } from './project-feedback.js';
import {
  LearningCanonicalProjectionService,
  type EvidenceRow,
} from './learning-canonical-projection.service.js';
import { learningWorkContextForProject, type WorkRow } from './learning-work-context.js';
import { checkBodyShape, checkIdempotencyKey, isPlainObject } from './validation.js';

interface ProjectRequestContext {
  readonly tenantId: string;
  readonly principalId: string;
  readonly userId: string | null;
  readonly accountId: string | null;
  readonly seatId: string | null;
}

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function genericProjectIdempotencyKey(value: string | undefined): string {
  const checked = checkIdempotencyKey(value);
  if (!checked.ok) {
    throw new HttpException(error('invalid_idempotency_key', checked.message), 400);
  }
  // Learning Start alone may allocate the deterministic Project for a Participation.
  if (checked.key.startsWith('learning:')) {
    throw new HttpException(
      error('invalid_idempotency_key', 'this Idempotency-Key prefix is reserved'),
      400,
    );
  }
  return checked.key;
}

const STATUS_BY_CODE: Record<ProjectErrorCode, number> = {
  validation_error: 400,
  dependency_unavailable: 503,
  idempotency_conflict: 409,
  project_revision_conflict: 409,
  learning_work_protected: 403,
  learning_work_read_only: 403,
  classroom_not_found: 404,
  project_not_found: 404,
};

@Controller('api/projects')
export class ProjectsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.moduleRegistry) private readonly moduleRegistry: ModuleRegistry,
    @Inject(TOKENS.createProjectUseCase) private readonly createUseCase: CreateProjectUseCase,
    @Inject(TOKENS.suggestProjectTitleUseCase)
    private readonly suggestTitleUseCase: SuggestProjectTitleUseCase,
    @Inject(TOKENS.listProjectsUseCase) private readonly listUseCase: ListProjectsUseCase,
    @Inject(TOKENS.openProjectUseCase) private readonly openUseCase: OpenProjectUseCase,
    @Inject(TOKENS.renameProjectUseCase) private readonly renameUseCase: RenameProjectUseCase,
    @Inject(TOKENS.changeProjectStatusUseCase)
    private readonly changeStatusUseCase: ChangeProjectStatusUseCase,
    @Inject(TOKENS.duplicateProjectUseCase)
    private readonly duplicateUseCase: DuplicateProjectUseCase,
    @Inject(TOKENS.saveDraftUseCase) private readonly saveUseCase: SaveDraftUseCase,
    @Inject(TOKENS.createCheckpointUseCase)
    private readonly checkpointUseCase: CreateCheckpointUseCase,
    @Inject(TOKENS.restoreVersionUseCase)
    private readonly restoreVersionUseCase: RestoreVersionUseCase,
    @Inject(TOKENS.listVersionsUseCase)
    private readonly listVersionsUseCase: ListVersionsUseCase,
    @Inject(TOKENS.saveProjectSnapshotUseCase)
    private readonly saveSnapshotUseCase: SaveProjectSnapshotUseCase,
    @Inject(TOKENS.readProjectSnapshotUseCase)
    private readonly readSnapshotUseCase: ReadProjectSnapshotUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
    @Inject(TOKENS.projectFeedbackService) private readonly feedback: ProjectFeedbackService,
    // Свойства работы и её видимость правятся функциями базы: там же, где
    // проверяется, чья это работа.
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  /**
   * Who is working, whether they signed in with an account or as a seat in a
   * class. Both arrive here as the same three facts, because a project belongs
   * to a principal and always has: nothing below this line needs to know which
   * kind of person is holding the pencil.
   */
  private async requireContext(request: FastifyRequest): Promise<ProjectRequestContext> {
    const account = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (account) {
      return {
        tenantId: account.tenantId,
        principalId: account.principalId,
        userId: account.userId,
        accountId: account.accountId,
        seatId: null,
      };
    }
    const seat = await this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    if (seat) {
      return {
        tenantId: seat.tenantId,
        principalId: seat.principalId,
        userId: seat.userId,
        accountId: null,
        seatId: seat.seatId,
      };
    }
    throw new HttpException(error('unauthorized', 'no active session'), 401);
  }

  private static actorOf(context: ProjectRequestContext): {
    principalId: string;
    userId: string | null;
  } {
    return { principalId: context.principalId, userId: context.userId };
  }

  private static reject(code: ProjectErrorCode, message: string): never {
    throw new HttpException(error(code, message), STATUS_BY_CODE[code]);
  }

  private analyse(moduleKey: string, document: unknown): unknown {
    const entry = this.moduleRegistry.get(moduleKey);
    const provider = entry?.provider;
    if (!provider) return null;
    const validated = provider.validate(document);
    if (!validated.ok || !provider.analyse) return null;
    return provider.analyse(validated.payload);
  }

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Query('scope') scope: string | undefined,
    @Query('kind') kind: string | undefined,
    @Query('collection') collection: string | undefined,
    @Query('classroomId') classroomId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('module') moduleKey: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('search') search: string | undefined,
    @Query('sort') sort: string | undefined,
    @Query('excludeGames') excludeGames: string | undefined,
  ): Promise<{ items: unknown[]; nextCursor?: string | null }> {
    const context = await this.requireContext(request);
    const result = await this.listUseCase.execute(
      context.tenantId,
      ProjectsController.actorOf(context),
      {
        scope,
        kind,
        collection,
        classroomId,
        status,
        moduleKey,
        limit,
        cursor,
        search,
        sort,
        excludeGames,
      },
    );
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    const last = result.value.at(-1);
    const items: unknown[] = [...result.value];
    if (result.value.some((project) => project.isLearningWork)) {
      if (!this.pool) {
        throw new HttpException(
          error('dependency_unavailable', 'learning context unavailable'),
          503,
        );
      }
      const pool = this.pool;
      const learningProjects = result.value.filter((project) => project.isLearningWork);
      const origins = await pool.query<{
        project_id: string;
        context: WorkRow;
        evidence: EvidenceRow;
      }>(
        `SELECT requested.project_id,reader.context,reader.evidence
           FROM unnest($2::uuid[]) AS requested(project_id)
           CROSS JOIN LATERAL learning_origin_work_context_for_project(
             $1,requested.project_id) reader`,
        [context.principalId, learningProjects.map((project) => project.id)],
      );
      const byProject = new Map<string, { context: WorkRow; evidence: EvidenceRow }[]>();
      for (const row of origins.rows) {
        const group = byProject.get(row.project_id) ?? [];
        group.push({ context: row.context, evidence: row.evidence });
        byProject.set(row.project_id, group);
      }
      // Canonical evidence for legacy compatibility is loaded only when this
      // page contains a protected Project without an immutable origin reader.
      const hasLegacyCandidate = learningProjects.some((project) => !byProject.has(project.id));
      const canonical = new LearningCanonicalProjectionService(pool);
      const legacyProjections = hasLegacyCandidate
        ? context.accountId
          ? await canonical.forAccount(context.accountId)
          : context.seatId
            ? await canonical.forSeat(context.seatId)
            : new Map()
        : new Map();
      const asOf = new Date().toISOString();
      const indices = result.value.flatMap((project, index) =>
        project.isLearningWork ? [index] : [],
      );
      // Exact readers are authorized and capped by the requested page. Eight
      // concurrent contexts avoid a serial 100-card request or a DB flood.
      for (let offset = 0; offset < indices.length; offset += 8) {
        await Promise.all(
          indices.slice(offset, offset + 8).map(async (index) => {
            const project = result.value[index]!;
            const work = await learningWorkContextForProject(
              pool,
              context.principalId,
              project.id,
              project.moduleKey,
              legacyProjections,
              asOf,
              byProject.get(project.id) ?? [],
              false,
            );
            items[index] = {
              ...project,
              learningWork:
                work.state === 'ready'
                  ? {
                      workflowState: work.workflow.canonicalState.workflowState,
                      collectionState: work.presentation.learnerCollectionState,
                      classroomTitle: work.presentation.classroomTitle,
                      courseTitle: work.presentation.courseTitle,
                      lessonTitle: work.presentation.lessonTitle,
                      taskTitle: work.task.title,
                      allowedActions: {
                        open: true,
                        continue:
                          work.allowedActions.edit ||
                          work.allowedActions.resumeAfterChangesRequested,
                        submit: work.allowedActions.submit,
                        changeGenericProjectStatus: work.allowedActions.changeGenericProjectStatus,
                        duplicate: false,
                        editProperties: false,
                        moveToLearningArchive: work.allowedActions.moveToLearningArchive,
                        restoreFromLearningArchive: work.allowedActions.restoreFromLearningArchive,
                        createPersonalCopy: work.allowedActions.createPersonalCopy,
                        publishOriginal: work.allowedActions.publishOriginal,
                      },
                    }
                  : {
                      workflowState: 'unavailable',
                      collectionState: 'unavailable',
                      classroomTitle: null,
                      courseTitle: null,
                      lessonTitle: null,
                      taskTitle: null,
                      allowedActions: {
                        open: true,
                        continue: false,
                        submit: false,
                        changeGenericProjectStatus: false,
                        duplicate: false,
                        editProperties: false,
                        moveToLearningArchive: false,
                        restoreFromLearningArchive: false,
                        createPersonalCopy: false,
                        publishOriginal: false,
                      },
                    },
            };
          }),
        );
      }
    }
    return {
      items,
      ...(limit === undefined
        ? {}
        : {
            nextCursor:
              last && result.value.length === Number(limit)
                ? Buffer.from(
                    JSON.stringify([sort ?? 'recent', last.updatedAt, last.id, last.title]),
                  ).toString('base64url')
                : null,
          }),
    };
  }

  @Get('title-suggestion')
  async suggestTitle(
    @Req() request: FastifyRequest,
    @Query('scope') scope: string | undefined,
    @Query('classroomId') classroomId: string | undefined,
    @Query('module') moduleKey: string | undefined,
  ): Promise<{ title: string; sequence: number }> {
    const context = await this.requireContext(request);
    const result = await this.suggestTitleUseCase.execute({
      tenantId: context.tenantId,
      scope,
      classroomId,
      actor: ProjectsController.actorOf(context),
      moduleKey,
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return result.value;
  }

  @Post()
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
  ): Promise<{ project: unknown; created: boolean }> {
    const context = await this.requireContext(request);
    if (isPlainObject(rawBody) && ('tenant_id' in rawBody || 'tenantId' in rawBody)) {
      throw new HttpException(
        error('validation_error', 'tenant is derived from the session and must not be sent'),
        400,
      );
    }
    const shape = checkBodyShape(rawBody, [
      'scope',
      'classroomId',
      'module',
      'title',
      'automaticTitle',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const idempotencyKey = genericProjectIdempotencyKey(idempotencyHeader);
    const result = await this.createUseCase.execute({
      tenantId: context.tenantId,
      scope: shape.body['scope'],
      classroomId: shape.body['classroomId'],
      actor: ProjectsController.actorOf(context),
      moduleKey: shape.body['module'],
      title: shape.body['title'],
      automaticTitle: shape.body['automaticTitle'],
      idempotencyKey,
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    reply.code(result.value.created ? 201 : 200);
    return { project: result.value.project, created: result.value.created };
  }

  /**
   * What every teacher has said about everything this person made.
   *
   * Declared above the parameterised routes so `feedback` is not read as a
   * project id. A learner asks this once when their projects load, which is how
   * the mark is on the card the moment the card appears rather than a beat
   * later, per card.
   */
  @Get('feedback')
  async myFeedback(@Req() request: FastifyRequest): Promise<{ items: unknown }> {
    const context = await this.requireContext(request);
    return { items: await this.feedback.mine(context.principalId) };
  }

  @Get(':projectId')
  async open(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<{ project: unknown; draft: unknown; versions: unknown[]; result: unknown }> {
    const context = await this.requireContext(request);
    const result = await this.openUseCase.execute(
      context.tenantId,
      projectId,
      ProjectsController.actorOf(context),
    );
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return {
      project: result.value.project,
      draft: result.value.draft,
      versions: result.value.versions,
      result: this.analyse(result.value.project.moduleKey, result.value.draft.document),
    };
  }

  @Patch(':projectId')
  async rename(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ project: unknown }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['title']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.renameUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      title: shape.body['title'],
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return { project: result.value };
  }

  @Post(':projectId/duplicate')
  async duplicate(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
  ): Promise<{ project: unknown; created: boolean }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['title']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const idempotencyKey = genericProjectIdempotencyKey(idempotencyHeader);
    const result = await this.duplicateUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      title: shape.body['title'],
      idempotencyKey,
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    reply.code(result.value.created ? 201 : 200);
    return result.value;
  }

  @Post(':projectId/status')
  async changeStatus(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ project: unknown }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['status']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.changeStatusUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      status: shape.body['status'],
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return { project: result.value };
  }

  @Post(':projectId/learning-collection')
  async changeLearningCollection(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ collectionState: 'active' | 'learning_archive' }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['collectionState']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    if (
      !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(projectId) ||
      !['active', 'learning_archive'].includes(String(shape.body['collectionState']))
    ) {
      throw new HttpException(
        error('validation_error', 'invalid learning collection transition'),
        400,
      );
    }
    if (!this.pool)
      throw new HttpException(error('dependency_unavailable', 'learning context unavailable'), 503);
    const changed = await this.pool.query<{ state: string }>(
      'SELECT learning_project_archive_set($1,$2,$3) AS state',
      [context.principalId, projectId, shape.body['collectionState'] === 'learning_archive'],
    );
    const state = changed.rows[0]?.state;
    if (state !== 'active' && state !== 'learning_archive') {
      throw new HttpException(
        error('learning_collection_denied', 'Эту учебную работу сейчас нельзя убрать или вернуть.'),
        403,
      );
    }
    return { collectionState: state };
  }

  @Put(':projectId/draft')
  async saveDraft(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ draft: unknown; result: unknown }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['document', 'baseRevision', 'mutationId']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    if (
      !Number.isSafeInteger(shape.body['baseRevision']) ||
      Number(shape.body['baseRevision']) < 0
    ) {
      throw new HttpException(
        error('validation_error', 'baseRevision must be a non-negative integer'),
        400,
      );
    }
    const result = await this.saveUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      document: shape.body['document'],
      baseRevision: Number(shape.body['baseRevision']),
      mutationId: String(shape.body['mutationId'] ?? ''),
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    const opened = await this.openUseCase.execute(
      context.tenantId,
      projectId,
      ProjectsController.actorOf(context),
    );
    if (!opened.ok) ProjectsController.reject(opened.code, opened.message);
    return {
      draft: result.value,
      result: this.analyse(opened.value.project.moduleKey, result.value.document),
    };
  }

  /**
   * The picture the editor captured of its own canvas.
   *
   * A snapshot is a convenience, never a condition of keeping work: an editor
   * fires this on its own schedule and a rejection must not read as "your
   * project failed to save". The response carries the revision the server
   * actually stored it against, which is what the card uses to cache it.
   */
  @Put(':projectId/snapshot')
  async saveSnapshot(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ snapshot: unknown }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['imageDataUrl', 'sourceRevision']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.saveSnapshotUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      imageDataUrl: shape.body['imageDataUrl'],
      sourceRevision: shape.body['sourceRevision'],
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return { snapshot: result.value };
  }

  /**
   * Delivery for a project card. The URL a card builds carries the revision the
   * snapshot was taken from, so a stored image is immutable for that URL and
   * may be cached indefinitely; new work produces a new URL. The response is
   * pinned to the format read out of the image itself and is declared
   * non-sniffable and script-free, because these bytes were uploaded by one
   * learner and are displayed to their class.
   */
  @Get(':projectId/snapshot')
  async readSnapshot(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Query('rev') rev: string | undefined,
  ): Promise<void> {
    const context = await this.requireContext(request);
    const result = await this.readSnapshotUseCase.execute(
      context.tenantId,
      projectId,
      ProjectsController.actorOf(context),
    );
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    const snapshot = result.value;
    const addressesThisRevision = rev !== undefined && rev === String(snapshot.sourceRevision);
    void reply
      .header('Content-Type', snapshot.contentType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header(
        'Cache-Control',
        addressesThisRevision
          ? 'private, max-age=31536000, immutable'
          : 'private, no-cache, must-revalidate',
      )
      .send(Buffer.from(snapshot.bytes));
  }

  /**
   * A teacher's response to a piece of work: a badge, a comment, or both.
   *
   * Who may respond is decided in the database, which knows whose learner this
   * is; a caller cannot leave that check out. Reading is wider than writing —
   * the learner reads what was said about their own work.
   */
  @Put(':projectId/feedback')
  async saveFeedback(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ feedback: unknown }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['badge', 'comment']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const badge = shape.body['badge'];
    const comment = shape.body['comment'];
    if (badge !== undefined && badge !== null && !FEEDBACK_BADGES.includes(String(badge))) {
      throw new HttpException(error('validation_error', 'unknown badge'), 400);
    }
    if (comment !== undefined && comment !== null && typeof comment !== 'string') {
      throw new HttpException(error('validation_error', 'comment must be text'), 400);
    }
    if ((badge === undefined || badge === null) && !String(comment ?? '').trim()) {
      throw new HttpException(
        error('validation_error', 'Отклик должен содержать значок или комментарий.'),
        400,
      );
    }
    const saved = await this.feedback.save(
      context.principalId,
      projectId,
      badge === undefined || badge === null ? null : String(badge),
      typeof comment === 'string' ? comment.slice(0, 1000) : null,
    );
    if (!saved) {
      ProjectsController.reject('project_not_found', 'project not found');
    }
    return { feedback: saved };
  }

  @Get(':projectId/feedback')
  async readFeedback(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<{ items: unknown[] }> {
    const context = await this.requireContext(request);
    return { items: await this.feedback.list(context.principalId, projectId) };
  }

  /**
   * Свойства работы: описание, теги, лицензия, кому видно.
   *
   * Имя правится здесь же — в референсе это один диалог, и разводить
   * переименование и остальное по разным местам значит заставлять человека
   * помнить, где что лежит.
   */
  @Put(':projectId/properties')
  async saveProperties(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, [
      'title',
      'description',
      'tags',
      'license',
      'visibility',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = shape.body['title'];
    const description = shape.body['description'] ?? null;
    const tags = shape.body['tags'] ?? [];
    const license = shape.body['license'] ?? 'reserved';
    const visibility = shape.body['visibility'] ?? null;

    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 255) {
      throw new HttpException(error('validation_error', 'Введите имя проекта.'), 400);
    }
    if (description !== null && (typeof description !== 'string' || description.length > 2000)) {
      throw new HttpException(error('validation_error', 'Описание слишком длинное.'), 400);
    }
    if (
      !Array.isArray(tags) ||
      tags.length > 10 ||
      tags.some((tag) => typeof tag !== 'string' || tag.length > 32)
    ) {
      throw new HttpException(error('validation_error', 'Не более десяти коротких тегов.'), 400);
    }
    const LICENCES = ['reserved', 'public-domain', 'cc-by', 'cc-by-sa', 'cc-by-nc'];
    if (typeof license !== 'string' || !LICENCES.includes(license)) {
      throw new HttpException(error('validation_error', 'Неизвестная лицензия.'), 400);
    }

    const pool = this.pool;
    if (!pool) throw new HttpException(error('database_unavailable', 'database'), 503);
    if (visibility !== null) {
      if (typeof visibility !== 'string' || !['private', 'link', 'public'].includes(visibility)) {
        throw new HttpException(error('validation_error', 'Неизвестная видимость.'), 400);
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const saved = await client.query(
        `SELECT project_properties_save($1, $2, $3, $4, $5, $6) AS ok`,
        [context.principalId, projectId, title.trim(), description, tags, license],
      );
      if ((saved.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
        throw new HttpException(error('project_not_found', 'Проект не найден.'), 404);
      }

      // Properties and visibility form one response: a refused publication
      // must not acknowledge a partially changed Project.
      if (visibility !== null) {
        const changed = await client.query(`SELECT project_visibility_set($1, $2, $3) AS ok`, [
          context.principalId,
          projectId,
          visibility,
        ]);
        if (
          (changed.rows[0] as { ok: boolean } | undefined)?.ok !== true &&
          visibility !== 'private'
        ) {
          throw new HttpException(
            error(
              'visibility_failed',
              'Чтобы поделиться работой, откройте её — редактор сохранит картинку.',
            ),
            400,
          );
        }
      }
      await client.query('COMMIT');
      return { ok: true as const };
    } catch (cause) {
      await client.query('ROLLBACK');
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        cause.code === 'P5L02'
      ) {
        throw new HttpException(
          error(
            'learning_work_read_only',
            'Эта учебная работа сейчас доступна только для просмотра.',
          ),
          403,
        );
      }
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        cause.code === 'P5L01'
      ) {
        throw new HttpException(
          error('learning_work_protected', 'Эту учебную работу нельзя публиковать в Сообществе.'),
          403,
        );
      }
      throw cause;
    } finally {
      client.release();
    }
  }

  /** The history itself, for a panel that opens without reloading the editor. */
  @Get(':projectId/versions')
  async versions(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
  ): Promise<{ versions: unknown[] }> {
    const context = await this.requireContext(request);
    const result = await this.listVersionsUseCase.execute(
      context.tenantId,
      projectId,
      ProjectsController.actorOf(context),
    );
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return { versions: [...result.value] };
  }

  /**
   * Going back to a saved version.
   *
   * What was on screen is checkpointed before it is replaced, so a learner who
   * pressed the wrong row can press their way back. Nothing is deleted: the
   * history only ever grows.
   */
  @Post(':projectId/versions/:versionId/restore')
  async restoreVersion(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('versionId') versionId: string,
  ): Promise<{ draft: unknown; versions: unknown[] }> {
    const context = await this.requireContext(request);
    const result = await this.restoreVersionUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      versionId,
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return { draft: result.value.draft, versions: [...result.value.versions] };
  }

  @Post(':projectId/checkpoints')
  async checkpoint(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ version: unknown }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody ?? {}, ['label']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.checkpointUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      label: shape.body['label'],
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    reply.code(201);
    return { version: result.value };
  }
}
