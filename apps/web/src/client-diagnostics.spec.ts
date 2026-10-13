import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('client diagnostics isolation', () => {
  it.each([
    '/api/analytics/v2/events',
    '/api/analytics/v2/module-session',
    '/api/analytics/v2/quality',
    '/api/diagnostics/quality?retry=1',
  ])('excludes the whole telemetry family from recursive diagnostics: %s', async (path) => {
    vi.resetModules();
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>(async () => new Response('{}', { status: 503 }));
    const browser = {
      fetch: transport,
      location: { href: 'https://asa.invalid/', origin: 'https://asa.invalid' },
      addEventListener: vi.fn(),
    };
    vi.stubGlobal('window', browser);
    vi.stubGlobal('fetch', transport);
    const { installClientDiagnostics } = await import('./client-diagnostics');
    installClientDiagnostics();
    const response = await browser.fetch(path);
    expect(response.status).toBe(503);
    expect(transport).toHaveBeenCalledOnce();
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).has('x-asa-diagnostic-module')).toBe(
      false,
    );
  });
  it('reports approved codes without project or session data and caps repeats', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }),
      );
    vi.stubGlobal('fetch', fetch);
    const { reportClientDiagnostic } = await import('./client-diagnostics');
    for (let i = 0; i < 100; i++) reportClientDiagnostic('editor_start_failed', 'scratch');
    expect(fetch).toHaveBeenCalledTimes(1);
    const options = fetch.mock.calls[0]![1] as RequestInit;
    expect(Object.keys(JSON.parse(options.body as string)).sort()).toEqual([
      'code',
      'eventId',
      'instanceId',
      'module',
      'occurredAt',
      'revision',
    ]);
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10000);
      reportClientDiagnostic('autosave_failed', 'electronics');
    }
    expect(fetch.mock.calls.length).toBe(21);
    await vi.advanceTimersByTimeAsync(60_001);
    const before = fetch.mock.calls.length;
    const { beginDiagnosticContext } = await import('./client-diagnostics');
    for (let i = 0; i < 100; i++) {
      beginDiagnosticContext('scratch');
      reportClientDiagnostic('editor_start_failed', 'scratch');
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(fetch.mock.calls.length - before).toBe(12);
  });
  it('correlates a failed API request while preserving response, credentials and unrelated fetches', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const id = '10000000-0000-4000-8000-000000000001';
    const response = new Response('private project content', {
      status: 500,
      headers: { 'x-request-id': id },
    });
    const transport = vi.fn().mockResolvedValue(response);
    const browser = {
      fetch: transport,
      location: { href: 'https://asa.invalid/', origin: 'https://asa.invalid' },
      addEventListener: vi.fn(),
    };
    vi.stubGlobal('window', browser);
    vi.stubGlobal('fetch', transport);
    const { installClientDiagnostics, beginDiagnosticContext } =
      await import('./client-diagnostics');
    const end = beginDiagnosticContext('electronics', id);
    installClientDiagnostics();
    installClientDiagnostics();
    const result = await browser.fetch('/api/projects/fixture/draft', {
      method: 'PATCH',
      credentials: 'include',
      body: 'private payload',
    });
    expect(result).toBe(response);
    const init = transport.mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('private payload');
    expect(new Headers(init.headers).get('x-asa-diagnostic-instance')).toBe(id);
    const diagnostic = JSON.parse((transport.mock.calls[1]![1] as RequestInit).body as string);
    expect(diagnostic).toMatchObject({
      code: 'request_failed',
      module: 'electronics',
      relatedRequestId: id,
      instanceId: id,
      httpStatus: 500,
      phase: 'request',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('private');
    await browser.fetch('https://external.invalid/api/test', { headers: { test: 'unchanged' } });
    expect(transport.mock.calls.at(-1)![1]).toEqual({ headers: { test: 'unchanged' } });
    end();
  });
  it('does not throw when logging transport fails', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { reportClientDiagnostic } = await import('./client-diagnostics');
    expect(() => reportClientDiagnostic('session_refresh_failed', 'auth')).not.toThrow();
    await Promise.resolve();
  });
});
