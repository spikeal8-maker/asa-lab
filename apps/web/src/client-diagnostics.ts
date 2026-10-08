export type DiagnosticCode =
  | 'render_failed'
  | 'window_error'
  | 'unhandled_rejection'
  | 'editor_start_failed'
  | 'editor_start_timeout'
  | 'editor_runtime_error'
  | 'simulation_failed'
  | 'autosave_failed'
  | 'session_refresh_failed';
export type DiagnosticModule = 'portal' | 'scratch' | 'electronics' | 'auth';
const recent = new Map<string, number>();
let windowStarted = 0;
let count = 0;

export function reportClientDiagnostic(code: DiagnosticCode, module: DiagnosticModule): void {
  try {
    const now = Date.now();
    if (now - windowStarted > 60_000) {
      windowStarted = now;
      count = 0;
    }
    const key = `${module}:${code}`;
    if (count >= 6 || now - (recent.get(key) ?? 0) < 10_000) return;
    recent.set(key, now);
    count += 1;
    const revision =
      typeof __ASA_BUILD_REVISION__ === 'string' && /^[a-f0-9]{7,64}$/.test(__ASA_BUILD_REVISION__)
        ? __ASA_BUILD_REVISION__
        : 'unknown';
    void fetch('/api/diagnostics/client', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, module, revision }),
    }).catch(() => undefined);
  } catch {
    /* Diagnostics must not change the product action. */
  }
}

export function installClientDiagnostics(): void {
  window.addEventListener('error', () => reportClientDiagnostic('window_error', 'portal'));
  window.addEventListener('unhandledrejection', () =>
    reportClientDiagnostic('unhandled_rejection', 'portal'),
  );
}
