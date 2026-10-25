import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { parseCatalogQuery } from './admin-user-catalog.js';
import { requireAiSameOrigin } from './ai-access.service.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function invalid(): never {
  throw new HttpException(
    { error: { code: 'validation_error', message: 'Проверьте поля запроса.' } },
    400,
  );
}
function id(value: unknown) {
  if (typeof value !== 'string' || !UUID.test(value)) invalid();
  return value;
}
function text(value: unknown, min: number, max: number) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) invalid();
  return value;
}
function sameOrigin(request: FastifyRequest): void {
  try {
    requireAiSameOrigin(request);
  } catch {
    throw new HttpException(
      {
        error: {
          code: 'crm_origin_denied',
          message: 'Изменение разрешено только с сайта ASA Lab.',
        },
      },
      403,
    );
  }
}
export function crmIdentity(kind: unknown, target: unknown, classroom: unknown) {
  if (kind !== 'account' && kind !== 'student') invalid();
  return { kind, target: id(target), classroom: classroom === undefined ? null : id(classroom) };
}
export function crmProfileInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => !['version', 'name', 'birthDate', 'country', 'bio', 'reason'].includes(key),
    )
  )
    invalid();
  const birth = body['birthDate'];
  if (birth !== null && (typeof birth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birth)))
    invalid();
  if (
    body['country'] !== null &&
    (typeof body['country'] !== 'string' || !/^[A-Z]{2}$/.test(body['country']))
  )
    invalid();
  return {
    version: text(body['version'], 64, 64),
    name: text(body['name'], 1, 120),
    birth: birth as string | null,
    country: body['country'] as string | null,
    bio: text(body['bio'], 0, 2000),
    reason: text(body['reason'], 3, 500),
  };
}

@Controller('api/crm/v1')
export class CrmUserController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool,
  ) {}
  private async actor(request: FastifyRequest) {
    const context = await this.accounts.resolve(request.cookies[SESSION_COOKIE]);
    if (!context)
      throw new HttpException(
        { error: { code: 'unauthorized', message: 'Войдите в аккаунт.' } },
        401,
      );
    return context.principalId;
  }
  private async query<T>(sql: string, args: unknown[]): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '8s'");
      const result = await client.query<{ value: T }>(sql, args);
      const value = result.rows[0]?.value;
      if (value === undefined || value === null) throw new Error('CRM_UNAVAILABLE');
      await client.query('COMMIT');
      return value;
    } catch (problem) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      const code = (problem as { code?: string }).code;
      if (code === '42501')
        throw new HttpException(
          {
            error: {
              code: 'crm_forbidden',
              message: 'Карточка недоступна в вашей области ответственности.',
            },
          },
          403,
        );
      if (code === '40001')
        throw new HttpException(
          { error: { code: 'crm_conflict', message: 'Данные уже изменились. Обновите карточку.' } },
          409,
        );
      if (['22023', '22007', '22008', '23514'].includes(code ?? '')) invalid();
      throw problem;
    } finally {
      client.release(discard ? true : undefined);
    }
  }
  @Get('users/:kind/:target')
  async card(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('target') target: string,
    @Query('classroomId') classroom: unknown,
  ) {
    const actor = await this.actor(request),
      subject = crmIdentity(kind, target, classroom);
    return this.query('SELECT crm_card($1,$2,$3,$4,$5) AS value', [
      actor,
      subject.kind,
      subject.target,
      subject.classroom,
      request.id,
    ]);
  }
  @Put('users/:kind/:target/profile')
  async update(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('target') target: string,
    @Body() body: unknown,
  ) {
    sameOrigin(request);
    const actor = await this.actor(request),
      subject = crmIdentity(kind, target, undefined),
      input = crmProfileInput(body);
    return this.query('SELECT crm_profile_update($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10) AS value', [
      actor,
      subject.kind,
      subject.target,
      input.version,
      input.name,
      input.birth,
      input.country,
      input.bio,
      input.reason,
      request.id,
    ]);
  }
  @Put('users/account/:target/capability')
  async capability(
    @Req() request: FastifyRequest,
    @Param('target') target: string,
    @Body() raw: unknown,
  ) {
    sameOrigin(request);
    const actor = await this.actor(request);
    id(target);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
    const body = raw as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => !['version', 'capability', 'state', 'reason'].includes(key))
    )
      invalid();
    const capability = text(body['capability'], 1, 40),
      state = text(body['state'], 1, 16);
    if (
      !['creator', 'educator', 'registered_student', 'guardian'].includes(capability) ||
      !['verified', 'suspended', 'revoked'].includes(state)
    )
      invalid();
    return this.query('SELECT crm_capability_update($1,$2,$3,$4,$5,$6,$7) AS value', [
      actor,
      target,
      text(body['version'], 64, 64),
      capability,
      state,
      text(body['reason'], 3, 500),
      request.id,
    ]);
  }
  @Get('users/:kind/:target/content')
  async content(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('target') target: string,
    @Query('classroomId') classroom: unknown,
    @Query('category') category: unknown,
    @Query('cursor') cursor: unknown,
  ) {
    const actor = await this.actor(request),
      subject = crmIdentity(kind, target, classroom);
    if (
      typeof category !== 'string' ||
      !['messages', 'projects', 'sessions', 'events'].includes(category)
    )
      invalid();
    let page: ReturnType<typeof parseCatalogQuery>;
    try {
      page = parseCatalogQuery({ limit: '25', cursor: cursor as string | undefined });
    } catch {
      invalid();
    }
    const value = await this.query<{ items: unknown[]; next: object | null }>(
      'SELECT crm_content_page($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS value',
      [
        actor,
        subject.kind,
        subject.target,
        subject.classroom,
        category,
        page.limit,
        page.cursor === null ? null : JSON.stringify(page.cursor),
        request.id,
      ],
    );
    return {
      ...value,
      next:
        value.next === null ? null : Buffer.from(JSON.stringify(value.next)).toString('base64url'),
    };
  }
  @Get('users/:kind/:target/projects/:project')
  async project(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('target') target: string,
    @Param('project') project: string,
    @Query('classroomId') classroom: unknown,
    @Query('versionId') version: unknown,
  ) {
    const actor = await this.actor(request),
      subject = crmIdentity(kind, target, classroom);
    return this.query('SELECT crm_project_read($1,$2,$3,$4,$5,$6,$7) AS value', [
      actor,
      subject.kind,
      subject.target,
      subject.classroom,
      id(project),
      version === undefined ? null : id(version),
      request.id,
    ]);
  }
  @Put('users/student/:target/status')
  async studentStatus(
    @Req() request: FastifyRequest,
    @Param('target') target: string,
    @Body() raw: unknown,
  ) {
    sameOrigin(request);
    const actor = await this.actor(request);
    id(target);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
    const body = raw as Record<string, unknown>;
    if (Object.keys(body).some((key) => !['version', 'status', 'reason'].includes(key))) invalid();
    if (body['status'] !== 'active' && body['status'] !== 'suspended') invalid();
    return this.query('SELECT crm_student_status_update($1,$2,$3,$4,$5,$6) AS value', [
      actor,
      target,
      text(body['version'], 64, 64),
      body['status'],
      text(body['reason'], 3, 500),
      request.id,
    ]);
  }
}
