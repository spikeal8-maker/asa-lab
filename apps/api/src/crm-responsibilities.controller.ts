import { Body, Controller, Get, HttpException, Inject, Param, Put, Req } from '@nestjs/common';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { requireAiSameOrigin } from './ai-access.service.js';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function responsibilityInput(kind: string, scope: string, target: string, body?: unknown) {
  if (!['organization', 'classroom'].includes(kind) || !uuid.test(scope) || !uuid.test(target))
    throw new HttpException('Invalid responsibility scope', 400);
  if (body === undefined) return null;
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new HttpException('Invalid command', 400);
  const b = body as Record<string, unknown>;
  if (
    Object.keys(b).some((k) => !['version', 'role', 'state', 'reason'].includes(k)) ||
    typeof b['version'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(b['version']) ||
    typeof b['role'] !== 'string' ||
    ![
      'owner',
      'school_admin',
      'moderator',
      'billing_admin',
      'member',
      'educator',
      'co_teacher',
    ].includes(b['role']) ||
    !['active', 'suspended', 'revoked'].includes(String(b['state'])) ||
    typeof b['reason'] !== 'string' ||
    b['reason'].trim().length < 3 ||
    b['reason'].length > 500
  )
    throw new HttpException('Invalid command', 400);
  return { version: b['version'], role: b['role'], state: b['state'], reason: b['reason'] };
}
@Controller('api/crm/v1/responsibilities')
export class CrmResponsibilitiesController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool,
  ) {}
  private async execute(
    request: FastifyRequest,
    kind: string,
    scope: string,
    target: string,
    body?: unknown,
  ) {
    const input = responsibilityInput(kind, scope, target, body);
    const context = await this.accounts.resolve(request.cookies[SESSION_COOKIE]);
    if (!context)
      throw new HttpException(
        { error: { code: 'unauthorized', message: 'Войдите в аккаунт.' } },
        401,
      );
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '8s'");
      const result = input
        ? await client.query('SELECT crm_responsibility_update($1,$2,$3,$4,$5,$6,$7,$8,$9) value', [
            context.principalId,
            kind,
            scope,
            target,
            input.version,
            input.role,
            input.state,
            input.reason,
            request.id,
          ])
        : await client.query('SELECT crm_responsibility_read($1,$2,$3,$4) value', [
            context.principalId,
            kind,
            scope,
            target,
          ]);
      await client.query('COMMIT');
      return result.rows[0]?.value;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      const code = (error as { code?: string }).code;
      if (['42501', '40001', '22023', '23505', '23514'].includes(code ?? ''))
        throw new HttpException(
          {
            error: {
              code:
                code === '42501'
                  ? 'crm_forbidden'
                  : code === '40001'
                    ? 'crm_conflict'
                    : 'validation_error',
              message:
                code === '40001'
                  ? 'Данные изменились. Обновите доступ.'
                  : 'Изменение доступа недоступно.',
            },
          },
          code === '42501' ? 403 : code === '40001' ? 409 : 400,
        );
      throw error;
    } finally {
      client.release(discard ? true : undefined);
    }
  }
  @Get(':kind/:scope/:target') read(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('scope') scope: string,
    @Param('target') target: string,
  ) {
    return this.execute(request, kind, scope, target);
  }
  @Put(':kind/:scope/:target') update(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('scope') scope: string,
    @Param('target') target: string,
    @Body() body: unknown,
  ) {
    try {
      requireAiSameOrigin(request);
    } catch {
      throw new HttpException('Origin denied', 403);
    }
    if (body === undefined) throw new HttpException('Command required', 400);
    return this.execute(request, kind, scope, target, body);
  }
}
