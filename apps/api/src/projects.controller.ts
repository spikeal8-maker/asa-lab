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
  ProjectScope,
  RenameProjectUseCase,
  SaveDraftUseCase,
} from '@asa-lab/projects';
import { parseElectronicsDocument, solveCircuit } from '@asa-lab/electronics';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape, checkIdempotencyKey, isPlainObject } from './validation.js';

const PROJECT_TITLE_MAX_LENGTH = 160;
const CHECKPOINT_LABEL_MAX_LENGTH = 160;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_SCOPES = new Set<ProjectScope>(['personal', 'classroom']);

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function validation(message: string): never {
  throw new HttpException(error('validation_error', message), 400);
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    validation(`${field} must be a UUID`);
  }
  return value;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireUuid(value, field);
}

function requireTrimmedString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') validation(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) validation(`${field} must not be empty`);
  if (trimmed.length > maximum) validation(`${field} must not exceed ${maximum} characters`);
  return trimmed;
}

function optionalTrimmedString(
  value: unknown,
  field: string,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requireTrimmedString(value, field, maximum);
}

function requireScope(value: unknown, optional = false): ProjectScope | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !PROJECT_SCOPES.has(value as ProjectScope)) {
    validation('scope must be personal or classroom');
  }
  return value as ProjectScope;
}

function requireModuleKey(value: unknown): 'electronics' {
  if (value !== 'electronics') validation('moduleKey must be electronics');
  return 'electronics';
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
    @Query('scope') rawScope: string | undefined,
    @Query('classroomId') rawClassroomId: string | undefined,
  ): Promise<{ items: unknown[]; meta: { total: number } }> {
    const context = await this.requireContext(request);
    const scope = requireScope(rawScope, true);
    const classroomId = optionalUuid(rawClassroomId, 'classroomId');
    const result = await this.listUseCase.execute(context.tenantId, context.userId, {
      scope,
      classroomId,
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return { items: result.value, meta: { total: result.value.length } };
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
      validation('tenant is derived from the session and must not be sent');
    }
    const shape = checkBodyShape(rawBody, ['scope', 'classroomId', 'moduleKey', 'title']);
    if (!shape.ok) validation(shape.message);
    const keyCheck = checkIdempotencyKey(idempotencyHeader);
    if (!keyCheck.ok)
      throw new HttpException(error('invalid_idempotency_key', keyCheck.message), 400);

    const scope = requireScope(shape.body['scope']) as ProjectScope;
    const classroomId =
      shape.body['classroomId'] === undefined || shape.body['classroomId'] === null
        ? null
        : requireUuid(shape.body['classroomId'], 'classroomId');
    const result = await this.createUseCase.execute({
      tenantId: context.tenantId,
      scope,
      classroomId,
      teacherId: context.userId,
      moduleKey: requireModuleKey(shape.body['moduleKey']),
      title: requireTrimmedString(shape.body['title'], 'title', PROJECT_TITLE_MAX_LENGTH),
      idempotencyKey: keyCheck.key,
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    reply.code(result.value.created ? 201 : 200);
    return { project: result.value.project, created: result.value.created };
  }

  @Get(':projectId')
  async open(
    @Req() request: FastifyRequest,
    @Param('projectId') rawProjectId: string,
  ): Promise<{ project: unknown; draft: unknown; versions: unknown[]; result: unknown }> {
    const context = await this.requireContext(request);
    const projectId = requireUuid(rawProjectId, 'projectId');
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
    @Param('projectId') rawProjectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ project: unknown }> {
    const context = await this.requireContext(request);
    const projectId = requireUuid(rawProjectId, 'projectId');
    const shape = checkBodyShape(rawBody, ['title']);
    if (!shape.ok) validation(shape.message);
    const result = await this.renameUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      teacherId: context.userId,
      title: requireTrimmedString(shape.body['title'], 'title', PROJECT_TITLE_MAX_LENGTH),
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    return { project: result.value };
  }

  @Put(':projectId/draft')
  async saveDraft(
    @Req() request: FastifyRequest,
    @Param('projectId') rawProjectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ draft: unknown; result: unknown }> {
    const context = await this.requireContext(request);
    const projectId = requireUuid(rawProjectId, 'projectId');
    const shape = checkBodyShape(rawBody, ['document']);
    if (!shape.ok) validation(shape.message);
    if (!Object.hasOwn(shape.body, 'document')) validation('document is required');
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
    @Param('projectId') rawProjectId: string,
    @Body() rawBody: unknown,
  ): Promise<{ version: unknown }> {
    const context = await this.requireContext(request);
    const projectId = requireUuid(rawProjectId, 'projectId');
    const shape = checkBodyShape(rawBody ?? {}, ['label']);
    if (!shape.ok) validation(shape.message);
    const result = await this.checkpointUseCase.execute({
      tenantId: context.tenantId,
      projectId,
      teacherId: context.userId,
      label: optionalTrimmedString(shape.body['label'], 'label', CHECKPOINT_LABEL_MAX_LENGTH),
    });
    if (!result.ok) ProjectsController.reject(result.code, result.message);
    reply.code(201);
    return { version: result.value };
  }
}
