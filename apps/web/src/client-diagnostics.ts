import { newClientId } from './client-id';
import { isAuthRequest } from './auth-request';
import {
  REQUEST_OPERATIONS,
  REQUEST_METHODS,
  REQUEST_FAILURE_KINDS,
  requestMethod,
  requestOperation,
  requestFailureKind,
} from './request-diagnostic-details';
import { diagnosticQuality } from './telemetry-quality';
import { isTelemetryPath } from './telemetry-contract';
import {
  clientException,
  validClientException,
  exceptionMatchesCode,
  type ClientException,
} from './client-error-details';
import {
  ASSET_SCRIPT,
  DiagnosticOutbox,
  FAILURE_CATEGORIES,
  FAILURE_CODES,
} from './client-diagnostic-outbox';

export type DiagnosticCode =
  | 'render_failed'
  | 'window_error'
  | 'unhandled_rejection'
  | 'editor_start_failed'
  | 'editor_start_timeout'
  | 'editor_runtime_error'
  | 'simulation_failed'
  | 'autosave_failed'
  | 'session_refresh_failed'
  | 'request_failed'
  | 'request_cancelled'
  | 'request_slow'
  | 'editor_ready'
  | 'editor_heartbeat'
  | 'editor_unresponsive'
  | 'editor_recovered';
export type DiagnosticModule = 'portal' | 'scratch' | 'electronics' | 'auth';
export interface DiagnosticDetail {
  readonly operation?: string;
  readonly method?: string;
  readonly clientAttemptId?: string;
  readonly failureKind?: string;
  readonly exception?: ClientException;
  readonly category?: string;
  readonly failureCode?: string;
  readonly script?: string;
  readonly line?: number;
  readonly column?: number;
  readonly relatedRequestId?: string | undefined;
  readonly httpStatus?: number;
  readonly durationMs?: number;
  readonly phase?: 'startup' | 'runtime' | 'request' | 'refresh' | 'save' | 'simulation';
}
const recent = new Map<string, number>();
let windowStarted = 0;
let count = 0;
let installed = false;
let outbox: DiagnosticOutbox | undefined;
function diagnosticOutbox(): DiagnosticOutbox {
  if (!outbox) {
    let storage: Storage | undefined;
    try {
      storage = window.sessionStorage;
    } catch {
      /* Storage may be unavailable. */
    }
    outbox = new DiagnosticOutbox(storage);
  }
  return outbox;
}
let context = { module: 'portal' as DiagnosticModule, instanceId: newClientId() };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function beginDiagnosticContext(
  module: DiagnosticModule,
  instanceId = newClientId(),
): () => void {
  context = { module, instanceId };
  return () => {
    if (context.instanceId === instanceId)
      context = { module: 'portal', instanceId: newClientId() };
  };
}

export function reportClientDiagnostic(
  code: DiagnosticCode,
  module: DiagnosticModule,
  detail: DiagnosticDetail = {},
): void {
  try {
    const now = Date.now();
    const quality = diagnosticQuality();
    quality.increment('attempted');
    if (now - windowStarted > 60_000) {
      windowStarted = now;
      count = 0;
    }
    const health = [
      'editor_ready',
      'editor_heartbeat',
      'editor_recovered',
      'request_cancelled',
    ].includes(code);
    const baseKey = `${context.instanceId}:${module}:${code}`;
    const scratchSave =
      code === 'autosave_failed' &&
      module === 'scratch' &&
      ['scratch-save-asset', 'scratch-save-draft', 'scratch-save-prepare'].includes(
        detail.failureCode ?? '',
      );
    const exception =
      validClientException(detail.exception) && exceptionMatchesCode(detail.exception, code)
        ? detail.exception
        : undefined;
    const frame = exception?.frames[0];
    const key =
      code === 'request_cancelled'
        ? baseKey
        : detail.clientAttemptId && UUID.test(detail.clientAttemptId)
          ? `${baseKey}:${detail.clientAttemptId}`
          : scratchSave
            ? `${baseKey}:${detail.failureCode}`
            : exception
              ? `${baseKey}:${exception.kind}:${exception.capture}:${frame?.script}:${frame?.line}:${frame?.column}`
              : baseKey;
    if (!health && count >= 12) {
      quality.increment('suppressed');
      return;
    }
    if (now - (recent.get(key) ?? -Infinity) < (health ? 60_000 : 10_000)) {
      quality.increment('deduplicated');
      return;
    }
    if (recent.size > 200) for (const [id, at] of recent) if (now - at > 60_000) recent.delete(id);
    recent.set(key, now);
    // A precise save report also covers a following generic controlled-exit failure.
    if (scratchSave) recent.set(baseKey, now);
    if (!health) count += 1;
    const revision =
      typeof __ASA_BUILD_REVISION__ === 'string' && /^[a-f0-9]{7,64}$/.test(__ASA_BUILD_REVISION__)
        ? __ASA_BUILD_REVISION__
        : 'unknown';
    const safe = {
      ...(REQUEST_OPERATIONS.includes(detail.operation as (typeof REQUEST_OPERATIONS)[number])
        ? { operation: detail.operation }
        : {}),
      ...(REQUEST_METHODS.includes(detail.method as (typeof REQUEST_METHODS)[number])
        ? { method: detail.method }
        : {}),
      ...(REQUEST_FAILURE_KINDS.includes(
        detail.failureKind as (typeof REQUEST_FAILURE_KINDS)[number],
      )
        ? { failureKind: detail.failureKind }
        : {}),
      ...(detail.clientAttemptId && UUID.test(detail.clientAttemptId)
        ? { clientAttemptId: detail.clientAttemptId }
        : {}),
      ...(exception
        ? {
            exception: {
              ...exception,
              frames: exception.frames.map((f) => ({
                script: f.script,
                line: f.line,
                column: f.column,
              })),
            },
          }
        : {}),
      ...(FAILURE_CATEGORIES.includes(detail.category as (typeof FAILURE_CATEGORIES)[number])
        ? { category: detail.category }
        : {}),
      ...(FAILURE_CODES.includes(detail.failureCode as (typeof FAILURE_CODES)[number])
        ? { failureCode: detail.failureCode }
        : {}),
      ...(detail.script && ASSET_SCRIPT.test(detail.script) ? { script: detail.script } : {}),
      ...Object.fromEntries(
        ['line', 'column'].flatMap((key) => {
          const value = detail[key as 'line' | 'column'];
          return Number.isInteger(value) && value! > 0 && value! <= 10_000_000
            ? [[key, value]]
            : [];
        }),
      ),
      ...(detail.relatedRequestId && UUID.test(detail.relatedRequestId)
        ? { relatedRequestId: detail.relatedRequestId }
        : {}),
      ...(Number.isInteger(detail.httpStatus) &&
      detail.httpStatus! >= 100 &&
      detail.httpStatus! <= 599
        ? { httpStatus: detail.httpStatus }
        : {}),
      ...(Number.isFinite(detail.durationMs)
        ? { durationMs: Math.max(0, Math.min(600_000, Math.round(detail.durationMs!))) }
        : {}),
      ...(detail.phase &&
      ['startup', 'runtime', 'request', 'refresh', 'save', 'simulation'].includes(detail.phase)
        ? { phase: detail.phase }
        : {}),
    };
    diagnosticOutbox().enqueue(
      {
        code,
        module,
        revision,
        instanceId: context.instanceId,
        eventId: newClientId(),
        occurredAt: now,
        ...safe,
      },
      false,
    );
  } catch {
    /* Diagnostics must not change the product action. */
  }
}

export function reportRenderDiagnostic(
  error: unknown,
  capture: 'app_boundary' | 'editor_boundary',
): void {
  try {
    reportClientDiagnostic(
      'render_failed',
      capture === 'app_boundary' ? 'portal' : context.module,
      {
        phase: 'runtime',
        exception: clientException(error, capture, window.location.origin),
      },
    );
  } catch {
    /* Error reporting must never break the boundary fallback. */
  }
}

export function installClientDiagnostics(): void {
  if (installed) return;
  installed = true;
  let suspended = false;
  diagnosticQuality().start();
  diagnosticOutbox().retryNow();
  window.addEventListener('online', () => {
    diagnosticOutbox().retryNow();
    void diagnosticQuality().flush();
  });
  window.addEventListener('pagehide', () => {
    suspended = true;
    void diagnosticQuality().flush(true);
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || !suspended) return;
    suspended = false;
    diagnosticQuality().resumeAfterPageShow();
    diagnosticOutbox().retryNow();
  });
  window.addEventListener('error', (event) => {
    let script: string | undefined;
    try {
      const url = new URL(event.filename, window.location.href);
      if (url.origin === window.location.origin && ASSET_SCRIPT.test(url.pathname))
        script = url.pathname;
    } catch {
      /* Cross-origin and non-script failures have no safe location. */
    }
    reportClientDiagnostic('window_error', context.module, {
      phase: 'runtime',
      exception: clientException(
        event.error,
        'window',
        window.location.origin,
        script ? { script, line: event.lineno, column: event.colno } : undefined,
      ),
      ...(script ? { script, line: event.lineno, column: event.colno } : {}),
    });
  });
  window.addEventListener('unhandledrejection', (event) =>
    reportClientDiagnostic('unhandled_rejection', context.module, {
      phase: 'runtime',
      exception: clientException(event.reason, 'rejection', window.location.origin),
    }),
  );
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    } catch {
      return original(input, init);
    }
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith('/api/') ||
      isTelemetryPath(url.pathname)
    )
      return original(input, init);
    const active = context;
    const module = isAuthRequest(url.pathname) ? 'auth' : active.module;
    const method = requestMethod(init?.method ?? (input instanceof Request ? input.method : 'GET'));
    const operation = requestOperation(url.pathname, method, module);
    const clientAttemptId = newClientId();
    const requestDetail = { operation, method, clientAttemptId };
    const signal =
      init?.signal !== undefined
        ? init.signal
        : input instanceof Request
          ? input.signal
          : undefined;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set('x-asa-diagnostic-instance', active.instanceId);
    headers.set('x-asa-diagnostic-module', module);
    headers.set('x-asa-client-attempt-id', clientAttemptId);
    const started = performance.now();
    try {
      const response = await original(input, { ...init, headers });
      const durationMs = performance.now() - started;
      const failed = response.status === 429 || response.status >= 500;
      // Late responses from a closed editor cannot belong to its successor.
      if (active.instanceId === context.instanceId && (failed || durationMs >= 10_000))
        reportClientDiagnostic(failed ? 'request_failed' : 'request_slow', module, {
          ...requestDetail,
          ...(failed ? { failureKind: 'http' } : {}),
          phase: 'request',
          httpStatus: response.status,
          durationMs,
          relatedRequestId: response.headers.get('x-request-id') ?? undefined,
        });
      return response;
    } catch (failure) {
      const failureKind = requestFailureKind(failure, signal);
      if (active.instanceId === context.instanceId)
        reportClientDiagnostic(
          failureKind === 'cancelled' && ['GET', 'HEAD'].includes(method)
            ? 'request_cancelled'
            : 'request_failed',
          module,
          {
            ...requestDetail,
            failureKind,
            phase: 'request',
            durationMs: performance.now() - started,
          },
        );
      throw failure;
    }
  };
}
