import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('client diagnostics isolation', () => {
  it('reports approved codes without project or session data and caps repeats', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    const { reportClientDiagnostic } = await import('./client-diagnostics');
    for (let i = 0; i < 100; i++) reportClientDiagnostic('editor_start_failed', 'scratch');
    expect(fetch).toHaveBeenCalledTimes(1);
    const options = fetch.mock.calls[0]![1] as RequestInit;
    expect(Object.keys(JSON.parse(options.body as string)).sort()).toEqual([
      'code',
      'instanceId',
      'module',
      'revision',
    ]);
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(10000);
      reportClientDiagnostic('autosave_failed', 'electronics');
    }
    expect(fetch.mock.calls.length).toBe(21);
    vi.advanceTimersByTime(60_001);
    const before = fetch.mock.calls.length;
    const { beginDiagnosticContext } = await import('./client-diagnostics');
    for (let i = 0; i < 100; i++) {
      beginDiagnosticContext('scratch');
      reportClientDiagnostic('editor_start_failed', 'scratch');
    }
    expect(fetch.mock.calls.length - before).toBe(12);
  });
  it('correlates a failed API request while preserving response, credentials and unrelated fetches', async () => {
    vi.resetModules();
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
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { reportClientDiagnostic } = await import('./client-diagnostics');
    expect(() => reportClientDiagnostic('session_refresh_failed', 'auth')).not.toThrow();
    await Promise.resolve();
  });
});
