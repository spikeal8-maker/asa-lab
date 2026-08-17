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
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type {
  ChangeProjectStatusUseCase,
  CreateCheckpointUseCase,
  CreateProjectUseCase,
  DuplicateProjectUseCase,
  ListProjectsUseCase,
  OpenProjectUseCase,
  ProjectErrorCode,
  ReadProjectSnapshotUseCase,
  RenameProjectUseCase,
  SaveDraftUseCase,
  SaveProjectSnapshotUseCase,
} from '@asa-lab/projects';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE, SeatContextUseCase } from './seat-context.js';
import { FEEDBACK_BADGES, ProjectFeedbackService } from './project-feedback.js';
import { checkBodyShape, checkIdempotencyKey, isPlainObject } from './validation.js';

interface ProjectRequestContext {
  readonly tenantId: string;
  readonly principalId: string;
  readonly userId: string | null;
}

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

const STATUS_BY_CODE: Record<ProjectErrorCode, number> = {
  validation_error: 400,
  idempotency_conflict: 409,
  classroom_not_found: 404,
  project_not_found: 404,
};

@Controller('api/projects')
export class ProjectsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.moduleRegistry) private readonly moduleRegistry: ModuleRegistry,
    @Inject(TOKENS.createProjectUseCase) private readonly createUseCase: CreateProjectUseCase,
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
    @Inject(TOKENS.saveProjectSnapshotUseCase)
    private readonly saveSnapshotUseCase: SaveProjectSnapshotUseCase,
    @Inject(TOKENS.readProjectSnapshotUseCase)
    private readonly readSnapshotUseCase: ReadProjectSnapshotUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
    @Inject(TOKENS.projectFeedbackService) private readonly feedback: ProjectFeedbackService,
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
      };
    }
    const seat = await this.seatContext.resolve(request.cookies[STUDENT_SESSION_COOKIE]);
    if (seat) {
      return { tenantId: seat.tenantId, principalId: seat.principalId, userId: seat.userId };
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
    @Query('classroomId') classroomId: string | undefined,
    @Query('status') status: string | undefined,
  ): Promise<{ items: unknown[] }> {
    const context = await this.requireContext(request);
    const result = await this.listUseCase.execute(
      context.tenantId,
      ProjectsController.actorOf(context),
      { scope, classroomId, status },
    );
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return { items: result.value };
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
    const shape = checkBodyShape(rawBody, ['scope', 'classroomId', 'module', 'title']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const keyCheck = checkIdempotencyKey(idempotencyHeader);
    if (!keyCheck.ok) {
      throw new HttpException(error('invalid_idempotency_key', keyCheck.message), 400);
    }
    const result = await this.createUseCase.execute({
      tenantId: context.tenantId,
      scope: shape.body['scope'],
      classroomId: shape.body['classroomId'],
      actor: ProjectsController.actorOf(context),
      moduleKey: shape.body['module'],
      title: shape.body['title'],
      idempotencyKey: keyCheck.key,
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
    const keyCheck = checkIdempotencyKey(idempotencyHeader);
    if (!keyCheck.ok) {
      throw new HttpException(error('invalid_idempotency_key', keyCheck.message), 400);
    }
    const result = await this.duplicateUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      title: shape.body['title'],
      idempotencyKey: keyCheck.key,
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

  @Put(':projectId/draft')
  async saveDraft(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ draft: unknown; result: unknown }> {
    const context = await this.requireContext(request);
    const shape = checkBodyShape(rawBody, ['document']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.saveUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      document: shape.body['document'],
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
    const shape = checkBodyShape(rawBody, ['imageDataUrl']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const result = await this.saveSnapshotUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      actor: ProjectsController.actorOf(context),
      imageDataUrl: shape.body['imageDataUrl'],
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
