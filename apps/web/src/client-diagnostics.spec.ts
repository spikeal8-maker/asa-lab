import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe('client diagnostics isolation', () => {
  it('retains distinct Scratch save stages while coalescing duplicate stage and generic exit failures', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const transport = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }),
    );
    vi.stubGlobal('window', {
      fetch: transport,
      sessionStorage: { getItem: () => null, setItem() {} },
    });
    vi.stubGlobal('fetch', transport);
    const { reportClientDiagnostic } = await import('./client-diagnostics');
    reportClientDiagnostic('autosave_failed', 'scratch', {
      phase: 'save',
      failureCode: 'scratch-save-asset',
    });
    reportClientDiagnostic('autosave_failed', 'scratch', {
      phase: 'save',
      failureCode: 'scratch-save-asset',
    });
    reportClientDiagnostic('autosave_failed', 'scratch', {
      phase: 'save',
      failureCode: 'scratch-save-draft',
    });
    reportClientDiagnostic('autosave_failed', 'scratch');
    await vi.advanceTimersByTimeAsync(0);
    const bodies = transport.mock.calls
      .filter(([path]) => path === '/api/diagnostics/client')
      .map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies.map((body) => body.failureCode)).toEqual([
      'scratch-save-asset',
      'scratch-save-draft',
    ]);
    const { diagnosticQuality } = await import('./telemetry-quality');
    expect(diagnosticQuality().read().counters.deduplicated).toBe(2);
  });
  it('OBS007 resumes anonymous quality and retries original diagnostics only once per cached return', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const data = new Map<string, string>();
    const listeners = new Map<string, (event: { persisted?: boolean }) => void>();
    const transport = vi.fn<typeof fetch>(async (_path, init) => {
      const body = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify(
          body.pipeline
            ? {
                accepted: true,
                state: 'intake_acknowledged',
                schemaVersion: 2,
                eventId: body.eventId,
                streamId: body.streamId,
                sequence: body.sequence,
                pipeline: body.pipeline,
                acknowledgementStage: body.acknowledgementStage,
              }
            : { accepted: true },
        ),
        { status: 202 },
      );
    });
    transport.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const browser = {
      fetch: transport,
      sessionStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
      },
      location: { href: 'https://asa.invalid/', origin: 'https://asa.invalid' },
      addEventListener: vi.fn((type: string, listener: (event: { persisted?: boolean }) => void) =>
        listeners.set(type, listener),
      ),
    };
    vi.stubGlobal('window', browser);
    vi.stubGlobal('fetch', transport);
    const { installClientDiagnostics, reportClientDiagnostic } =
      await import('./client-diagnostics');
    const { diagnosticQuality } = await import('./telemetry-quality');
    installClientDiagnostics();
    reportClientDiagnostic('autosave_failed', 'electronics');
    await Promise.resolve();
    await Promise.resolve();
    const diagnostic = transport.mock.calls[0]![1]!.body;
    listeners.get('pagehide')!({ persisted: true });
    await diagnosticQuality().flush();
    const streamId = diagnosticQuality().read().streamId;
    expect(diagnosticQuality().read().coverage.final).toBe(true);
    listeners.get('pageshow')?.({ persisted: false });
    expect(diagnosticQuality().read().coverage.final).toBe(true);
    listeners.get('pageshow')?.({ persisted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(diagnosticQuality().read()).toMatchObject({ streamId, coverage: { final: false } });
    const diagnosticCalls = transport.mock.calls.filter(
      ([path]) => path === '/api/diagnostics/client',
    );
    expect(diagnosticCalls).toHaveLength(2);
    expect(diagnosticCalls[1]![1]!.body).toBe(diagnostic);
    const calls = transport.mock.calls.length;
    listeners.get('pageshow')?.({ persisted: true });
    listeners.get('pageshow')?.({ persisted: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(calls);
  });

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
