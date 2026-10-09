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
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { TOKENS, SESSION_COOKIE } from './tokens.js';
import { AdminControlPlaneService } from './admin-control-plane.service.js';
import { AdminLogsService } from './admin-logs.service.js';
import type { LogFilter } from './admin-logs.worker.js';

function fail(code: string, status: number): never {
  throw new HttpException(
    { error: { code, message: 'Журналы недоступны или запрос некорректен.' } },
    status,
  );
}

export function logFilter(input: unknown): LogFilter {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    fail('validation_error', 400);
  const value = input as Record<string, unknown>;
  const date = (key: string, fallback: number): string => {
    const raw = value[key];
    if (raw === undefined || raw === '') return new Date(fallback).toISOString();
    if (
      typeof raw !== 'string' ||
      !/^\d{4}-\d\d-\d\dT/.test(raw) ||
      !Number.isFinite(Date.parse(raw))
    )
      fail('validation_error', 400);
    return new Date(raw).toISOString();
  };
  const from = date('from', Date.now() - 7 * 86400_000);
  const to = date('to', Date.now());
  if (from > to || Date.parse(to) - Date.parse(from) > 31 * 86400_000)
    fail('validation_error', 400);
  const text = (key: string, max: number): string => {
    const raw = value[key];
    if (raw === undefined || raw === '') return '';
    if (
      typeof raw !== 'string' ||
      raw.length > max ||
      Array.from(raw).some((c) => c.charCodeAt(0) < 32)
    )
      fail('validation_error', 400);
    return raw;
  };
  const source = text('source', 200);
  const module = text('module', 20);
  const level = text('level', 10);
  const scope = text('scope', 20) || 'all';
  if (!['all', 'application', 'host'].includes(scope)) fail('validation_error', 400);
  if (module && !['scratch', 'electronics', 'auth', 'portal', 'system'].includes(module))
    fail('validation_error', 400);
  if (level && !['error', 'warn', 'info'].includes(level)) fail('validation_error', 400);
  const beforeTime = text('beforeTime', 30);
  const beforeId = text('beforeId', 64);
  if (
    (beforeTime || beforeId) &&
    (!/^\d{4}-\d\d-\d\dT/.test(beforeTime) ||
      !Number.isFinite(Date.parse(beforeTime)) ||
      !/^[a-f0-9]{64}$/.test(beforeId))
  )
    fail('validation_error', 400);
  return {
    scope: scope as NonNullable<LogFilter['scope']>,
    from,
    to,
    source,
    module,
    level,
    search: text('search', 120),
    before: beforeTime ? { time: new Date(beforeTime).toISOString(), id: beforeId } : null,
  };
}

@Controller('api/admin/v1/logs')
export class AdminLogsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly context: ActiveContextUseCase,
    @Inject(TOKENS.adminControlPlane) private readonly admin: AdminControlPlaneService,
    @Inject(AdminLogsService) private readonly logs: AdminLogsService,
  ) {}

  private async allow(request: FastifyRequest): Promise<string> {
    const context = await this.context.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) fail('unauthorized', 401);
    const access = await this.admin.resolveAccess(context);
    if (
      !this.admin.authorize(access, 'administration.operations.read', {
        kind: 'platform',
        id: null,
      })
    )
      fail('admin_scope_forbidden', 403);
    await this.admin.recordLogRead(access, request.id);
    return context.principalId;
  }

  private async response<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (failure) {
      const code = (failure as Error).message;
      fail(
        code === 'LOG_NOT_FOUND'
          ? 'not_found'
          : code === 'LOG_BUSY' || code === 'LOG_EXPORT_LIMIT'
            ? 'logs_busy'
            : 'logs_unavailable',
        code === 'LOG_NOT_FOUND'
          ? 404
          : code === 'LOG_BUSY' || code === 'LOG_EXPORT_LIMIT'
            ? 429
            : 503,
      );
    }
  }

  @Get('status')
  async status(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.allow(request);
    reply.header('Cache-Control', 'no-store');
    return this.response(() => this.logs.status());
  }

  @Get()
  async query(
    @Req() request: FastifyRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const owner = await this.allow(request);
    reply.header('Cache-Control', 'no-store');
    const filter = logFilter(query);
    const cursor = (query as Record<string, unknown>)['scanCursor'];
    if (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f0-9-]{36}$/.test(cursor)))
      fail('validation_error', 400);
    const value = query as Record<string, unknown>;
    return this.response(() =>
      this.logs.query(filter, owner, cursor as string | undefined, {
        from: !value['from'],
        to: !value['to'],
      }),
    );
  }

  @Post('exports')
  async create(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const owner = await this.allow(request);
    reply.header('Cache-Control', 'no-store');
    const filter = logFilter(body);
    return this.response(() => this.logs.createExport(owner, filter));
  }

  @Get('exports/:id')
  async progress(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const owner = await this.allow(request);
    reply.header('Cache-Control', 'no-store');
    return this.response(() => this.logs.exportStatus(owner, id));
  }

  @Get('exports/:id/download')
  async download(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const owner = await this.allow(request);
    const file = await this.response(() => this.logs.download(owner, id));
    reply
      .header('Cache-Control', 'no-store')
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="asa-lab-logs.zip"')
      .header('Content-Length', file.bytes)
      .header('X-Content-Type-Options', 'nosniff');
    return reply.send(file.stream);
  }
}
