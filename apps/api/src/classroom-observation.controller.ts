import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type pg from 'pg';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';
import { ClassroomObservationService } from './classroom-observation.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code: string, message: string, status: number): never {
  throw new HttpException({ error: { code, message } }, status);
}
function uuid(value: string): string {
  if (!UUID.test(value)) fail('validation_error', 'Некорректный идентификатор.', 400);
  return value;
}
function timestamp(value: string | undefined): string | null {
  if (value === undefined) return null;
  const date = value.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T.*| .*)?$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    date.startsWith('0000') ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
  )
    fail('validation_error', 'Некорректная дата.', 400);
  return value;
}
@Controller('api/classrooms')
export class ClassroomObservationController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}
  private db() {
    if (!this.pool) fail('database_unavailable', 'Сервер данных недоступен.', 503);
    return new ClassroomObservationService(this.pool);
  }
  private async actor(request: FastifyRequest) {
    const actor = await this.accounts.resolve(request.cookies[SESSION_COOKIE]);
    if (!actor) fail('unauthorized', 'Войдите в аккаунт.', 401);
    return actor.principalId;
  }
  private classes(body: unknown): string[] {
    const shape = checkBodyShape(body, ['classroomIds']);
    const ids = shape.ok ? shape.body['classroomIds'] : null;
    if (
      !Array.isArray(ids) ||
      ids.length > 200 ||
      new Set(ids).size !== ids.length ||
      !ids.every((id) => typeof id === 'string' && UUID.test(id))
    )
      fail('validation_error', 'Ожидается до 200 разных классов.', 400);
    return ids as string[];
  }
  /** The existing admission materializer is an explicit operation, separate
   * from the read-only summary/projects/history projections. */
  @Post('observation/prepare')
  async prepare(@Req() request: FastifyRequest, @Body() body: unknown) {
    const actor = await this.actor(request);
    const ids = this.classes(body);
    // Authorize the entire set as teacher before invoking the shared preparer.
    await this.db().read('classroom_observation_summary', [actor, ids]);
    await this.db().read('classroom_participant_prepare', [actor, ids]);
    return { ok: true };
  }
  @Post('observation/summary')
  async summary(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.db().read('classroom_observation_summary', [
      await this.actor(request),
      this.classes(body),
    ]);
  }
  @Get(':classroomId/observation/projects')
  async projects(
    @Req() request: FastifyRequest,
    @Param('classroomId') classId: string,
    @Query('module') module?: string,
    @Query('learner') learner?: string,
    @Query('search') search?: string,
    @Query('assignment') assignment?: string,
    @Query('archive') archive?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    if (
      (module !== undefined && !['three-d', 'electronics', 'blocks'].includes(module)) ||
      (assignment !== undefined && !['assigned', 'unassigned'].includes(assignment)) ||
      (archive !== undefined && !['true', 'false'].includes(archive)) ||
      (offset !== undefined && (!/^\d{1,6}$/.test(offset) || Number(offset) > 100000)) ||
      (limit !== undefined && !['30', '50'].includes(limit)) ||
      (search?.length ?? 0) > 100
    )
      fail('validation_error', 'Некорректный фильтр работ.', 400);
    return this.db().read('classroom_observation_projects', [
      await this.actor(request),
      uuid(classId),
      module ?? null,
      learner ? uuid(learner) : null,
      search?.trim() || null,
      assignment ?? null,
      archive === 'true',
      Number(offset ?? 0),
      Number(limit ?? 30),
    ]);
  }
  @Get(':classroomId/observation/history')
  async history(
    @Req() request: FastifyRequest,
    @Param('classroomId') classId: string,
    @Query('learner') learner?: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (category !== undefined && !['all', 'access', 'projects'].includes(category))
      fail('validation_error', 'Некорректный фильтр истории.', 400);
    const [before, id, extra] = cursor?.split('|') ?? [];
    if (
      cursor !== undefined &&
      (!before ||
        !id ||
        extra !== undefined ||
        !/^(?:(?:class|submission|activation):[0-9a-f-]{36}|(?:auth|edit):\d{1,20})$/.test(id))
    )
      fail('validation_error', 'Некорректная страница истории.', 400);
    if (from && to && Date.parse(from) >= Date.parse(to))
      fail('validation_error', 'Некорректный диапазон дат.', 400);
    return this.db().read('classroom_observation_history', [
      await this.actor(request),
      uuid(classId),
      learner ? uuid(learner) : null,
      category ?? 'all',
      timestamp(from),
      timestamp(to),
      timestamp(before),
      id ?? null,
    ]);
  }
}
