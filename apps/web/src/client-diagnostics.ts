import { newClientId } from './client-id';

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
  | 'request_slow'
  | 'editor_ready'
  | 'editor_heartbeat'
  | 'editor_unresponsive'
  | 'editor_recovered';
export type DiagnosticModule = 'portal' | 'scratch' | 'electronics' | 'auth';
export interface DiagnosticDetail {
  readonly relatedRequestId?: string | undefined;
  readonly httpStatus?: number;
  readonly durationMs?: number;
  readonly phase?: 'startup' | 'runtime' | 'request' | 'refresh' | 'save' | 'simulation';
}
const recent = new Map<string, number>();
let windowStarted = 0;
let count = 0;
let installed = false;
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
    if (now - windowStarted > 60_000) {
      windowStarted = now;
      count = 0;
    }
    const health = ['editor_ready', 'editor_heartbeat', 'editor_recovered'].includes(code);
    const key = `${context.instanceId}:${module}:${code}`;
    if (
      (!health && count >= 12) ||
      now - (recent.get(key) ?? -Infinity) < (health ? 60_000 : 10_000)
    )
      return;
    if (recent.size > 200) for (const [id, at] of recent) if (now - at > 60_000) recent.delete(id);
    recent.set(key, now);
    if (!health) count += 1;
    const revision =
      typeof __ASA_BUILD_REVISION__ === 'string' && /^[a-f0-9]{7,64}$/.test(__ASA_BUILD_REVISION__)
        ? __ASA_BUILD_REVISION__
        : 'unknown';
    const safe = {
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
    void fetch('/api/diagnostics/client', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, module, revision, instanceId: context.instanceId, ...safe }),
    }).catch(() => undefined);
  } catch {
    /* Diagnostics must not change the product action. */
  }
}

export function installClientDiagnostics(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', () => reportClientDiagnostic('window_error', context.module));
  window.addEventListener('unhandledrejection', () =>
    reportClientDiagnostic('unhandled_rejection', context.module),
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
      url.pathname === '/api/diagnostics/client'
    )
      return original(input, init);
    const active = context;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set('x-asa-diagnostic-instance', active.instanceId);
    headers.set(
      'x-asa-diagnostic-module',
      url.pathname.includes('/auth/') ? 'auth' : active.module,
    );
    const started = performance.now();
    try {
      const response = await original(input, { ...init, headers });
      const durationMs = performance.now() - started;
      // Late responses from a closed editor cannot belong to its successor.
      if (
        active.instanceId === context.instanceId &&
        (response.status >= 500 || durationMs >= 10_000)
      )
        reportClientDiagnostic(
          response.status >= 500 ? 'request_failed' : 'request_slow',
          active.module,
          {
            phase: 'request',
            httpStatus: response.status,
            durationMs,
            relatedRequestId: response.headers.get('x-request-id') ?? undefined,
          },
        );
      return response;
    } catch (failure) {
      if (
        active.instanceId === context.instanceId &&
        !(failure instanceof DOMException && failure.name === 'AbortError')
      )
        reportClientDiagnostic('request_failed', active.module, {
          phase: 'request',
          durationMs: performance.now() - started,
        });
      throw failure;
    }
  };
}
