import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { sessionDatabaseDiagnostics } from './session-database-diagnostics.js';
import { logSubsystem, safeLogPath } from './log-subsystems.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MODULES = new Set(['portal', 'scratch', 'electronics', 'auth']);
export const requestFailures = new WeakMap<object, string>();
export const requestValidationReasons = new WeakMap<object, string>();
export interface AdmissionDiagnostics {
  readonly credentialCheck: 'class_not_found' | 'student_rejected' | 'student_accepted';
  readonly blockedBudgets: ReadonlyArray<
    'candidate_class' | 'source_class' | 'source_total' | 'class_lookup_source'
  >;
  readonly limiterPhase: 'after_failed_validation' | 'not_applied';
}
// Server-owned classifications only; never retain the IP, codes or bucket keys.
export const requestAdmissionDiagnostics = new WeakMap<object, AdmissionDiagnostics>();
const VALIDATION_REASONS = new Set<string>([
  // Explicit API exposure policy; canonical classification stays in the module.
  'electronics_component_id',
  'electronics_component_kind',
  'electronics_component_name',
  'electronics_component_pins',
  'electronics_component_position',
  'electronics_component_rotation',
  'electronics_component_shape',
  'electronics_component_state',
  'electronics_component_type',
  'electronics_component_value',
  'electronics_component_variant',
  'electronics_component_wiper',
  'electronics_connection_endpoint',
  'electronics_connection_id',
  'electronics_connection_shape',
  'electronics_document_arrays',
  'electronics_document_shape',
  'electronics_document_size',
  'electronics_hole_binding_reference',
  'electronics_hole_binding_shape',
  'electronics_hole_bindings_shape',
  'electronics_internal_connection_pair',
  'electronics_internal_connection_reference',
  'electronics_internal_connections',
  'electronics_model_identity',
  'electronics_schema_version',
  'electronics_simulation',
  'electronics_state_properties',
  'electronics_state_value',
  'electronics_viewport',
  'electronics_wire_color',
  'electronics_wire_position',
  'electronics_wire_vertices',
  'draft_body_invalid',
  'draft_base_revision_invalid',
  'draft_mutation_id_invalid',
  'draft_document_unserializable',
  'draft_module_unavailable',
]);
export function safeValidationReason(value: unknown): string | undefined {
  return typeof value === 'string' && VALIDATION_REASONS.has(value) ? value : undefined;
}

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
      : /connect(?:ion)?.*timeout|timeout.*connect(?:ion)?/i.test(message)
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
    if (status === 400 && code === 'validation_error') {
      const reason = safeValidationReason(
        (response as { error?: { reasonCode?: unknown } }).error?.reasonCode,
      );
      if (reason) requestValidationReasons.set(request, reason);
    }
  }
  requestFailures.set(request, failure.errorCode);
  if (status >= 500)
    process.stdout.write(
      `${JSON.stringify({ time: new Date().toISOString(), kind: 'server_error', level: 'error', requestId: request.id, revision: revision, method: request.method, path: safeLogPath(request.raw.url), subsystem: logSubsystem('api', request.raw.url), status, ...failure, ...diagnosticContext(request), sessionDatabase: sessionDatabaseDiagnostics(request), runtime: { rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed, cpuMicros: process.cpuUsage(), pool: pool ? { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } : null } })}\n`,
    );
}
