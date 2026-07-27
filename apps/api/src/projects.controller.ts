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
import type { SessionContext, SessionUseCase } from '@asa-lab/identity';
import type {
  CreateCheckpointUseCase,
  CreateProjectUseCase,
  ListProjectsUseCase,
  OpenProjectUseCase,
  ProjectErrorCode,
  RenameProjectUseCase,
  SaveDraftUseCase,
} from '@asa-lab/projects';
import { parseElectronicsDocument, solveCircuit } from '@asa-lab/electronics';
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
    @Inject(TOKENS.sessionUseCase) private readonly sessionUseCase: SessionUseCase,
    @Inject(TOKENS.createProjectUseCase) private readonly createUseCase: CreateProjectUseCase,
    @Inject(TOKENS.listProjectsUseCase) private readonly listUseCase: ListProjectsUseCase,
    @Inject(TOKENS.openProjectUseCase) private readonly openUseCase: OpenProjectUseCase,
    @Inject(TOKENS.renameProjectUseCase) private readonly renameUseCase: RenameProjectUseCase,
    @Inject(TOKENS.saveDraftUseCase) private readonly saveUseCase: SaveDraftUseCase,
    @Inject(TOKENS.createCheckpointUseCase)
    private readonly checkpointUseCase: CreateCheckpointUseCase,
  ) {}

  private async requireContext(request: FastifyRequest): Promise<SessionContext> {
    const context = await this.sessionUseCase.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    return context;
  }
  private static reject(code: ProjectErrorCode, message: string): never {
    throw new HttpException(error(code, message), STATUS_BY_CODE[code]);
  }
  private static analyse(document: unknown): unknown {
    const parsed = parseElectronicsDocument(document);
    return parsed.ok ? solveCircuit(parsed.document) : null;
  }

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Query('scope') scope: string | undefined,
    @Query('classroomId') classroomId: string | undefined,
  ): Promise<{ items: unknown[] }> {
    const context = await this.requireContext(request);
    const result = await this.listUseCase.execute(context.tenantId, context.userId, {
      scope,
      classroomId,
    });
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
    if (isPlainObject(rawBody) && ('tenant_id' in rawBody || 'tenantId' in rawBody))
      throw new HttpException(
        error('validation_error', 'tenant is derived from the session and must not be sent'),
        400,
      );
    const shape = checkBodyShape(rawBody, ['scope', 'classroomId', 'module', 'title']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const keyCheck = checkIdempotencyKey(idempotencyHeader);
    if (!keyCheck.ok)
      throw new HttpException(error('invalid_idempotency_key', keyCheck.message), 400);
    const result = await this.createUseCase.execute({
      tenantId: context.tenantId,
      scope: shape.body['scope'],
      classroomId: shape.body['classroomId'],
      teacherId: context.userId,
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
    const result = await this.openUseCase.execute(context.tenantId, projectId, context.userId);
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return {
      project: result.value.project,
      draft: result.value.draft,
      versions: result.value.versions,
      result: ProjectsController.analyse(result.value.draft.document),
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
      teacherId: context.userId,
      title: shape.body['title'],
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
      teacherId: context.userId,
      document: shape.body['document'],
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return { draft: result.value, result: ProjectsController.analyse(result.value.document) };
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
      teacherId: context.userId,
      label: shape.body['label'],
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    reply.code(201);
    return { version: result.value };
  }
}
