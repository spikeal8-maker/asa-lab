import { createHmac, randomBytes } from 'node:crypto';
import type { LogEntry } from './admin-logs.worker.js';
import { isHostLogSource, LOG_MODULES, LOG_SUBSYSTEMS } from './log-subsystems.js';
import { SCRATCH_SAVE_FAILURE_CODES } from './scratch-save-diagnostics.js';
import { safeValidationReason } from './validation-reasons.js';

const SOURCES = new Set([
  ...LOG_MODULES,
  'api',
  'web',
  'postgres',
  'minio',
  'minio-init',
  'search',
  'migration',
  'audit',
  'updates',
  'backup',
  'tunnel',
  'linux:journal',
  'docker-lifecycle',
  'docker-desktop',
  'metrics',
]);
const LABELS: Readonly<Record<string, readonly string[]>> = {
  kind: [
    'client_diagnostic',
    'client_diagnostic_quality',
    'http_response',
    'http_request_started',
    'http_request_ended',
    'request_failed',
    'response_timeout',
    'container_state',
    'container_lifecycle',
    'system_service_failure',
    'system_journal',
    'kernel_oom',
    'classroom_join_admission',
  ],
  code: [
    'render_failed',
    'window_error',
    'unhandled_rejection',
    'editor_start_failed',
    'editor_start_timeout',
    'editor_runtime_error',
    'simulation_failed',
    'autosave_failed',
    'session_refresh_failed',
    'request_failed',
    'request_cancelled',
    'request_slow',
    'editor_ready',
    'editor_heartbeat',
    'editor_unresponsive',
    'editor_recovered',
    'too_many_attempts',
    'too_many_requests',
    'unavailable',
    'response_timeout',
  ],
  errorCode: [
    'too_many_attempts',
    'too_many_requests',
    'unavailable',
    'response_timeout',
    'validation_error',
  ],
  reasonCode: ['too_many_attempts', 'too_many_requests', 'unavailable', 'response_timeout'],
  phase: ['startup', 'runtime', 'request', 'refresh', 'save', 'simulation'],
  category: ['unsupported', 'nonconvergent', 'electrical', 'physical', 'runtime', 'technical'],
  failureCode: [
    ...SCRATCH_SAVE_FAILURE_CODES,
    'worker-start',
    'worker-runtime',
    'worker-message',
    'worker-post',
    'worker-timeout',
    'invalid-response',
    'stale-response',
    'cancelled',
    'worker-failure',
    'physical_advance_failed',
    'electrical_sample_failed',
    'electrical_quality_failed',
    'clocked_profile_unsupported',
    'arduino_execution_failed',
    'timed_advance_failed',
  ],
  operation: [
    'auth_me',
    'auth_refresh',
    'auth_other',
    'project_read',
    'project_save',
    'electronics_draft_read',
    'electronics_draft_write',
    'blocks_runtime_session',
    'other_api',
  ],
  failureKind: ['http', 'timeout', 'cancelled', 'network', 'unknown'],
  method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER'],
  action: ['oom', 'die', 'restart', 'start', 'stop', 'kill', 'destroy', 'health_status: unhealthy'],
  Status: ['created', 'running', 'restarting', 'removing', 'paused', 'exited', 'dead'],
  unit: ['apt-daily.service', 'apt-daily-upgrade.service', 'ssh.service'],
};
const NUMBERS = [
  'status',
  'statusCode',
  'httpStatus',
  'durationMs',
  'elapsedMs',
  'retryAfterSeconds',
  'repetitionCount',
  'occurredAt',
  'firstOccurredAt',
  'lastOccurredAt',
  'line',
  'column',
  'ExitCode',
  'exitCode',
  'responseBytes',
  'requestBytes',
] as const;
const FLAGS = ['OOMKilled', 'untrustedClientReport', 'untrustedClientContext'] as const;
const CORRELATION = [
  'requestId',
  'relatedRequestId',
  'clientAttemptId',
  'instanceId',
  'eventId',
] as const;
const REASONS = [
  'quality stream conflict',
  'telemetry project denied',
  'deadlock detected',
  'statement timeout',
  'lock timeout',
  'too many clients',
  'remaining connection slots',
  'connection reset',
  'failed to fetch',
  'timed out',
] as const;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStructured(message: string): Record<string, unknown> {
  if (!message.trimStart().startsWith('{')) return {};
  try {
    return record(JSON.parse(message));
  } catch {
    return {};
  }
}

export function createHandoffProjector() {
  // A random key per archive permits joins within it while hiding original IDs.
  const key = randomBytes(32);
  const alias = (namespace: string, value: string): string =>
    createHmac('sha256', key).update(`${namespace}\0${value.toLowerCase()}`).digest('hex');

  return (event: LogEntry, moduleMatch: boolean) => {
    const structured = readStructured(event.message);
    const detail: Record<string, string | number | boolean | string[]> = {};
    for (const [field, values] of Object.entries(LABELS)) {
      const value = structured[field];
      if (typeof value === 'string' && values.includes(value)) detail[field] = value;
    }
    const validationReason = safeValidationReason(structured.reasonCode);
    if (detail.errorCode === 'validation_error' && validationReason) {
      detail.reasonCode = validationReason;
    }
    for (const field of NUMBERS) {
      const value = structured[field];
      if (typeof value === 'number' && Number.isSafeInteger(value)) detail[field] = value;
    }
    for (const field of FLAGS) {
      const value = structured[field];
      if (typeof value === 'boolean') detail[field] = value;
    }
    for (const field of CORRELATION) {
      const value =
        field === 'requestId' ? (event.requestId ?? structured[field]) : structured[field];
      if (typeof value === 'string' && UUID.test(value))
        detail[field] = alias('correlation', value);
    }
    if (structured['path'] === '/api/class-join/studentseat') {
      detail.route = 'class-join/studentseat';
      const admission = record(structured['admission']);
      const credentialCheck = admission['credentialCheck'];
      if (
        credentialCheck === 'class_not_found' ||
        credentialCheck === 'student_rejected' ||
        credentialCheck === 'student_accepted'
      )
        detail.credentialCheck = credentialCheck;
      const budgets = admission['blockedBudgets'];
      if (Array.isArray(budgets)) {
        detail.blockedBudgets = [
          'candidate_class',
          'source_class',
          'source_total',
          'class_lookup_source',
        ].filter((budget) => budgets.includes(budget));
      }
    }
    const plainPostgresMessage =
      event.source === 'postgres' && !event.message.trimStart().startsWith('{');
    const reasons = plainPostgresMessage
      ? REASONS.filter((reason) => event.message.toLowerCase().includes(reason))
      : undefined;
    const source = SOURCES.has(event.source)
      ? event.source
      : isHostLogSource(event.source)
        ? 'host'
        : 'other';
    return {
      id: alias('record', event.id),
      time: new Date(event.time).toISOString(),
      source,
      module: (LOG_MODULES as readonly string[]).includes(event.module) ? event.module : 'other',
      subsystem: (LOG_SUBSYSTEMS as readonly string[]).includes(event.subsystem ?? '')
        ? event.subsystem
        : undefined,
      level: ['error', 'warn', 'info'].includes(event.level) ? event.level : 'other',
      timeBasis: ['event', 'file_mtime', 'transcript'].includes(event.timeBasis ?? '')
        ? event.timeBasis
        : undefined,
      truncated: event.truncated === true,
      build:
        typeof event.revision === 'string' && /^[a-f0-9]{7,64}$/.test(event.revision)
          ? alias('build', event.revision)
          : undefined,
      error: event.level === 'error',
      selectedModule: moduleMatch,
      detail,
      ...(reasons?.length ? { recognizedMessages: reasons } : {}),
    };
  };
}
