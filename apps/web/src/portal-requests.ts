import { abortable } from './auth-request';
import { subscribeTelemetry, telemetryContext } from './telemetry-context';
import { isTelemetryPath } from './telemetry-contract';

const PORTAL_READS = new Set([
  '/api/auth/me',
  '/api/class-join/me',
  '/api/class-join/me/assignment-counts',
  '/api/class-join/account/assignments',
  '/api/classrooms/awaiting-review',
  '/api/projects',
  '/api/public-projects',
  '/api/modules',
]);
const MAX_TRANSPORTS = 4;
const MAX_BACKGROUND = 2;
const MAX_QUEUED = 64;
const READ_DEADLINE_MS = 30_000;

const pathname = (path: string): string => path.split('?')[0]!;
const cancelled = (): DOMException => new DOMException('Request context changed', 'AbortError');
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase();
export const isPortalRead = (path: string, init: RequestInit = {}): boolean =>
  methodOf(init) === 'GET' && init.body == null && PORTAL_READS.has(pathname(path));

interface ReadFlight {
  controller: AbortController;
  promise: Promise<unknown>;
  consumers: number;
  settled: boolean;
}
const reads = new Map<string, ReadFlight>();
const liveReads = new Set<ReadFlight>();
let readEpoch = 0;
let sessionEpoch = 0;
let sessionKey = '';

/** No completed-response cache: canonical identity reads always reach the server. */
export function invalidatePortalReads(): void {
  readEpoch += 1;
  reads.clear();
}

/** A local asynchronous fence, never an authentication or authorization decision. */
export function invalidatePortalSession(): void {
  sessionEpoch += 1;
  invalidatePortalReads();
  for (const flight of liveReads) flight.controller.abort(cancelled());
}
export const portalSessionEpoch = (): number => sessionEpoch;

let observedContext = telemetryContext();
subscribeTelemetry((context) => {
  if (
    context.continuity !== observedContext.continuity ||
    context.ready !== observedContext.ready
  ) {
    invalidatePortalSession();
  }
  observedContext = context;
});

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stableScope(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableScope).sort().join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableScope(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Include server-issued grants and workspace scopes, not a presentation role. */
export function portalSessionKey(state: { kind: string; session?: unknown }): string {
  const value = record(state.session);
  return stableScope({
    kind: state.kind,
    account: record(value['account'])['id'],
    workspace: value['activeWorkspace'],
    workspaces: value['workspaces'],
    capabilities: value['capabilities'],
    actions: value['actions'],
    navigation: value['navigation'],
    verificationRequired: record(value['verification'])['required'] === true,
    seat: record(value['student'])['seatId'],
    classroom: record(value['classroom'])['id'],
    safeMode: record(value['student'])['safeMode'],
  });
}
export function setPortalSessionKey(key: string): void {
  if (sessionKey === key) return;
  sessionKey = key;
  invalidatePortalSession();
}

/** Counts follow actual navigation, not new objects or list-filter keystrokes. */
export function portalAttentionRoute(view: {
  kind: string;
  projectId?: string;
  classroomId?: string;
  courseId?: string;
  publicationId?: string;
}): string {
  return JSON.stringify([
    view.kind,
    view.projectId,
    view.classroomId,
    view.courseId,
    view.publicationId,
  ]);
}

function requestKey(path: string, init: RequestInit): string {
  // Keep the exact query, including duplicate-parameter order. A different filter,
  // cursor, credential mode or representation must never join this response.
  return JSON.stringify([
    readEpoch,
    path,
    methodOf(init),
    [...new Headers(init.headers).entries()].sort(([a], [b]) => a.localeCompare(b)),
    init.credentials ?? 'same-origin',
    init.mode ?? 'cors',
    init.redirect ?? 'follow',
    init.referrer ?? 'about:client',
    init.referrerPolicy ?? '',
    init.integrity ?? '',
    init.cache ?? 'no-store',
    init.keepalive ?? false,
    init.priority ?? 'auto',
  ]);
}

/** Share the entire JSON read, with independent cancellation and result objects. */
export function portalRead<T>(
  path: string,
  init: RequestInit,
  operation: (request: RequestInit) => Promise<T>,
): Promise<T> {
  if (!isPortalRead(path, init)) return operation(init);
  if (init.signal?.aborted) return Promise.reject(init.signal.reason ?? cancelled());
  const key = requestKey(path, init);
  let flight = reads.get(key);
  if (!flight) {
    const controller = new AbortController();
    const expectedSession = sessionEpoch;
    const created: ReadFlight = {
      controller,
      consumers: 0,
      settled: false,
      promise: Promise.resolve(),
    };
    reads.set(key, created);
    liveReads.add(created);
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Read deadline exceeded', 'TimeoutError')),
      READ_DEADLINE_MS,
    );
    created.promise = abortable(
      () => operation({ ...init, signal: controller.signal }),
      controller.signal,
    )
      .then((result) => {
        if (sessionEpoch !== expectedSession) throw cancelled();
        return result;
      })
      .finally(() => {
        created.settled = true;
        clearTimeout(timeout);
        liveReads.delete(created);
        if (reads.get(key) === created) reads.delete(key);
      });
    flight = created;
  }
  const shared = flight;
  shared.consumers += 1;
  return abortable(() => shared.promise as Promise<T>, init.signal)
    .then((result) => structuredClone(result))
    .finally(() => {
      shared.consumers -= 1;
      if (!shared.settled && shared.consumers === 0) {
        if (reads.get(key) === shared) reads.delete(key);
        shared.controller.abort(cancelled());
      }
    });
}

function changesSession(path: string): boolean {
  return /^\/api\/(?:auth(?:\/|$)|session\/context$|capabilities(?:\/|$)|account\/(?:role|capabilities)(?:\/|$)|class-join\/(?:logout|studentseat|join|activate|claim|login)(?:\/|$)|class-join\/account$)/.test(
    pathname(path),
  );
}

/** Invalidate synchronously on both sides of a write; never coalesce a mutation. */
export function beginPortalMutation(path: string, init: RequestInit): () => void {
  if (['GET', 'HEAD'].includes(methodOf(init)) || isTelemetryPath(path)) return () => undefined;
  const invalidate = changesSession(path) ? invalidatePortalSession : invalidatePortalReads;
  invalidate();
  return invalidate;
}

const mutationListeners = new Set<(path: string) => void>();
export function onPortalMutation(listener: (path: string) => void): () => void {
  mutationListeners.add(listener);
  return () => {
    mutationListeners.delete(listener);
  };
}
export function portalMutationCompleted(path: string, init: RequestInit): void {
  if (['GET', 'HEAD'].includes(methodOf(init)) || isTelemetryPath(path)) return;
  for (const listener of mutationListeners) {
    try {
      listener(pathname(path));
    } catch {
      // A badge subscriber cannot change the outcome of an already completed write.
    }
  }
}

/** Server advice is a bounded lower limit for the caller's own retry policy. */
export function retryAfterMilliseconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after')?.trim();
  if (!header) return undefined;
  const delay = /^\d+(?:\.\d+)?$/.test(header)
    ? Number(header) * 1000
    : Date.parse(header) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? Math.min(Math.ceil(delay), 60_000) : undefined;
}

interface TransportTask {
  background: boolean;
  signal: AbortSignal | null | undefined;
  start: (release: () => void) => void;
  reject: (reason: unknown) => void;
  cancelled: () => void;
}
const queue: TransportTask[] = [];
let active = 0;
let backgroundActive = 0;

function drain(): void {
  while (active < MAX_TRANSPORTS) {
    let index = queue.findIndex((task) => !task.background);
    if (index < 0 && backgroundActive < MAX_BACKGROUND) index = 0;
    if (index < 0 || index >= queue.length) return;
    const task = queue.splice(index, 1)[0]!;
    task.signal?.removeEventListener('abort', task.cancelled);
    if (task.signal?.aborted) {
      task.reject(task.signal.reason ?? cancelled());
      continue;
    }
    active += 1;
    if (task.background) backgroundActive += 1;
    let released = false;
    task.start(() => {
      if (released) return;
      released = true;
      active -= 1;
      if (task.background) backgroundActive -= 1;
      drain();
    });
  }
}

function readsBoundedJson(path: string, init: RequestInit): boolean {
  return (
    isPortalRead(path, init) ||
    (methodOf(init) === 'GET' &&
      /^\/api\/games\/(?:chess|checkers)\/notifications$/.test(pathname(path)))
  );
}

/** Hold admission through the complete JSON operation, including body delivery.
 * Streams, resource downloads and writes keep their original immediate transport.
 */
export function schedulePortalJson<T>(
  path: string,
  init: RequestInit,
  operation: () => Promise<T>,
): Promise<T> {
  // pagehide saves must start immediately, before the browser abandons JS work.
  if (init.keepalive || !readsBoundedJson(path, init)) return abortable(operation, init.signal);
  if (init.signal?.aborted) return Promise.reject(init.signal.reason ?? cancelled());
  const expectedScope = sessionEpoch;
  return new Promise((resolve, reject) => {
    if (queue.length >= MAX_QUEUED) {
      const background =
        init.priority === 'low' ? -1 : queue.map((task) => task.background).lastIndexOf(true);
      if (background < 0) {
        reject(new TypeError('Request queue is full'));
        return;
      }
      const deferred = queue.splice(background, 1)[0]!;
      deferred.signal?.removeEventListener('abort', deferred.cancelled);
      deferred.reject(new DOMException('Background request deferred', 'AbortError'));
    }
    const task: TransportTask = {
      background: init.priority === 'low',
      signal: init.signal,
      reject,
      cancelled: () => {
        const index = queue.indexOf(task);
        if (index >= 0) queue.splice(index, 1);
        reject(init.signal?.reason ?? cancelled());
      },
      start: (release) => {
        try {
          if (sessionEpoch !== expectedScope) throw cancelled();
          void abortable(operation, init.signal).then(
            (result) => {
              release();
              resolve(result);
            },
            (error) => {
              release();
              reject(error);
            },
          );
        } catch (error) {
          release();
          reject(error);
        }
      },
    };
    init.signal?.addEventListener('abort', task.cancelled, { once: true });
    queue.push(task);
    drain();
  });
}
