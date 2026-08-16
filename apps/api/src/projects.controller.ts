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
import type { ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
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
import { checkBodyShape, checkIdempotencyKey, isPlainObject } from './validation.js';

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
  ) {}

  private async requireContext(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) {
      throw new HttpException(error('unauthorized', 'no active session'), 401);
    }
    return context;
  }

  private static actorOf(context: ActiveContext): {
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
