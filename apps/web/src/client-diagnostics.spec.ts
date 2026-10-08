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
      'module',
      'revision',
    ]);
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(10000);
      reportClientDiagnostic('autosave_failed', 'electronics');
    }
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(20);
  });
  it('does not throw when logging transport fails', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { reportClientDiagnostic } = await import('./client-diagnostics');
    expect(() => reportClientDiagnostic('session_refresh_failed', 'auth')).not.toThrow();
    await Promise.resolve();
  });
});
