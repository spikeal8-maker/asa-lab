// Fixed vocabulary and generated coordinates only; never serialize Error itself.
export const EXCEPTION_KINDS = [
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
] as const;
export const ERROR_CAPTURES = ['window', 'rejection', 'app_boundary', 'editor_boundary'] as const;
export const ERROR_ASSET = /^\/assets\/[A-Za-z0-9_-]{1,140}-[A-Za-z0-9_-]{8,16}\.js$/;
export interface ErrorFrame {
  readonly script: string;
  readonly line: number;
  readonly column: number;
}
export interface ClientException {
  readonly kind: (typeof EXCEPTION_KINDS)[number];
  readonly capture: (typeof ERROR_CAPTURES)[number];
  readonly handling: 'unhandled' | 'boundary_fallback';
  readonly frames: readonly ErrorFrame[];
}
const coordinate = (v: unknown): v is number =>
  Number.isInteger(v) && Number(v) > 0 && Number(v) <= 10_000_000;
export function validClientException(value: unknown): value is ClientException {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 4 &&
    Object.keys(v).every((k) => ['kind', 'capture', 'handling', 'frames'].includes(k)) &&
    EXCEPTION_KINDS.includes(v.kind as ClientException['kind']) &&
    ERROR_CAPTURES.includes(v.capture as ClientException['capture']) &&
    v.handling === (String(v.capture).endsWith('_boundary') ? 'boundary_fallback' : 'unhandled') &&
    Array.isArray(v.frames) &&
    v.frames.length <= 5 &&
    v.frames.every(
      (f) =>
        f &&
        typeof f === 'object' &&
        !Array.isArray(f) &&
        Object.keys(f).length === 3 &&
        Object.keys(f).every((k) => ['script', 'line', 'column'].includes(k)) &&
        typeof f.script === 'string' &&
        ERROR_ASSET.test(f.script) &&
        coordinate(f.line) &&
        coordinate(f.column),
    )
  );
}
export function clientException(
  error: unknown,
  capture: ClientException['capture'],
  origin: string,
  fallback?: ErrorFrame,
): ClientException {
  let kind: ClientException['kind'] = 'unknown';
  const frames: ErrorFrame[] = [];
  try {
    if (error && typeof error === 'object') {
      const name = (error as Error).name;
      if (EXCEPTION_KINDS.includes(name as ClientException['kind']))
        kind = name as ClientException['kind'];
      const stack = (error as Error).stack;
      if (typeof stack === 'string')
        for (const line of stack.slice(0, 16384).split('\n').slice(0, 32)) {
          // Chrome/Edge and Firefox/Safari. Function names and header text are discarded.
          const match = /(?:^|[@( ])(https?:\/\/[^\s()]+):(\d+):(\d+)\)?$/.exec(line.trim());
          if (!match) continue;
          const url = new URL(match[1]!);
          const frame = { script: url.pathname, line: Number(match[2]), column: Number(match[3]) };
          if (
            url.origin !== origin ||
            url.search ||
            url.hash ||
            url.username ||
            url.password ||
            !ERROR_ASSET.test(frame.script) ||
            !coordinate(frame.line) ||
            !coordinate(frame.column)
          )
            continue;
          if (
            !frames.some(
              (f) =>
                f.script === frame.script && f.line === frame.line && f.column === frame.column,
            )
          )
            frames.push(frame);
          if (frames.length === 5) break;
        }
    }
  } catch {
    /* Hostile getters, non-Error throws and unavailable stack are not product failures. */
  }
  if (
    !frames.length &&
    fallback &&
    ERROR_ASSET.test(fallback.script) &&
    coordinate(fallback.line) &&
    coordinate(fallback.column)
  )
    frames.push({ script: fallback.script, line: fallback.line, column: fallback.column });
  return {
    kind,
    capture,
    handling: capture.endsWith('_boundary') ? 'boundary_fallback' : 'unhandled',
    frames,
  };
}

export function exceptionMatchesCode(exception: ClientException, code: unknown): boolean {
  return exception.capture === 'window'
    ? code === 'window_error'
    : exception.capture === 'rejection'
      ? code === 'unhandled_rejection'
      : code === 'render_failed';
}
