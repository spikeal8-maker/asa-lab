// Independent validation at the untrusted JSON intake; no Error/stack/message API.
export function validClientException(value: unknown, code: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 4 &&
    Object.keys(v).every((k) => ['kind', 'capture', 'handling', 'frames'].includes(k)) &&
    [
      'Error',
      'TypeError',
      'ReferenceError',
      'RangeError',
      'SyntaxError',
      'URIError',
      'EvalError',
      'AggregateError',
      'AbortError',
      'SecurityError',
      'QuotaExceededError',
      'InvalidStateError',
      'NetworkError',
      'unknown',
    ].includes(v['kind'] as string) &&
    ['window', 'rejection', 'app_boundary', 'editor_boundary'].includes(v['capture'] as string) &&
    v['handling'] ===
      (String(v['capture']).endsWith('_boundary') ? 'boundary_fallback' : 'unhandled') &&
    (v['capture'] === 'window'
      ? code === 'window_error'
      : v['capture'] === 'rejection'
        ? code === 'unhandled_rejection'
        : code === 'render_failed') &&
    Array.isArray(v['frames']) &&
    v['frames'].length <= 5 &&
    v['frames'].every(
      (f: Record<string, unknown>) =>
        f &&
        typeof f === 'object' &&
        !Array.isArray(f) &&
        Object.keys(f).length === 3 &&
        Object.keys(f).every((k) => ['script', 'line', 'column'].includes(k)) &&
        typeof f['script'] === 'string' &&
        /^\/assets\/[A-Za-z0-9_-]{1,140}-[A-Za-z0-9_-]{8,16}\.js$/.test(f['script']) &&
        ['line', 'column'].every(
          (k) => Number.isInteger(f[k]) && Number(f[k]) > 0 && Number(f[k]) <= 10_000_000,
        ),
    )
  );
}
