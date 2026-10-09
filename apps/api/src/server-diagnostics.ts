import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MODULES = new Set(['portal', 'scratch', 'electronics', 'auth']);
export const requestFailures = new WeakMap<object, string>();

export function diagnosticContext(request: FastifyRequest) {
  const instance = request.headers['x-asa-diagnostic-instance'];
  const module = request.headers['x-asa-diagnostic-module'];
  return {
    ...(typeof instance === 'string' && UUID.test(instance) ? { instanceId: instance } : {}),
    ...(typeof module === 'string' && MODULES.has(module)
      ? { module, untrustedClientContext: true }
      : {}),
  };
}

export function safeServerError(exception: unknown) {
  const error = exception instanceof Error ? exception : null;
  const message = error?.message ?? '';
  const errorCode =
    /query read timeout|statement timeout|canceling statement due to statement timeout/i.test(
      message,
    )
      ? 'database_query_timeout'
      : /connection.*timeout|timeout.*connection/i.test(message)
        ? 'database_connection_timeout'
        : /ECONNREFUSED|ECONNRESET/.test(message)
          ? 'upstream_connection_failed'
          : 'internal_error';
  const frames = (error?.stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => {
      // ANSI color escapes in Nest stacks are not part of a call frame.
      // eslint-disable-next-line no-control-regex
      return line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    })
    .filter(
      (line) => line.startsWith('at ') && /:\d+:\d+\)?$/.test(line) && !/[?="'\r\n]/.test(line),
    )
    .slice(0, 10)
    .map((line) => line.slice(0, 240));
  return {
    errorCode,
    errorClass: /^[A-Za-z]{1,48}$/.test(error?.name ?? '') ? error!.name : 'Error',
    frames,
  };
}

export class ServerDiagnosticsFilter extends BaseExceptionFilter {
  constructor(
    adapter: ConstructorParameters<typeof BaseExceptionFilter>[0],
    private readonly revision: string | null,
    private readonly pool: pg.Pool | null,
  ) {
    super(adapter);
  }
  override catch(exception: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const external = exception as { statusCode?: unknown; message?: unknown } | null;
    const native =
      external &&
      typeof external === 'object' &&
      Number.isInteger(external.statusCode) &&
      (external.statusCode as number) >= 400 &&
      (external.statusCode as number) <= 599 &&
      typeof external.message === 'string'
        ? { statusCode: external.statusCode as number, message: external.message }
        : null;
    const status =
      exception instanceof HttpException ? exception.getStatus() : (native?.statusCode ?? 500);
    recordServerFailure(exception, request, status, this.revision, this.pool);
    // Preserve Nest's public response, while replacing its unstructured unknown
    // exception logger. Arbitrary exception messages can contain SQL or secrets.
    super.catch(
      exception instanceof HttpException
        ? exception
        : new HttpException(
            native ?? { statusCode: 500, message: 'Internal server error' },
            status,
          ),
      host,
    );
  }
}
export function recordServerFailure(
  exception: unknown,
  request: FastifyRequest,
  status: number,
  revision: string | null,
  pool: pg.Pool | null,
): void {
  if (requestFailures.has(request)) return;
  const failure = safeServerError(exception);
  if (status < 500 && failure.errorCode === 'internal_error') failure.errorCode = 'http_error';
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    const code =
      typeof response === 'object' && response !== null
        ? (response as { error?: { code?: unknown } }).error?.code
        : null;
    if (typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code)) failure.errorCode = code;
  }
  requestFailures.set(request, failure.errorCode);
  if (status >= 500)
    process.stdout.write(
      `${JSON.stringify({ time: new Date().toISOString(), kind: 'server_error', level: 'error', requestId: request.id, revision: revision, method: request.method, path: (request.raw.url ?? '/').split('?')[0], status, ...failure, ...diagnosticContext(request), runtime: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed, cpuMicros: process.cpuUsage(), pool: pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } : null } })}\n`,
    );
}
