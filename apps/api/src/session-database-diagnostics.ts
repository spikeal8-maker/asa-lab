import { AsyncLocalStorage } from 'node:async_hooks';
import type pg from 'pg';
import type { SessionContextQuery } from '@asa-lab/identity';

interface Measurements {
  operation: 'identity.session.resolve';
  calls: number;
  failures: number;
  poolAcquireMs: number;
  queryRoundTripMs: number;
  lastFailurePhase?: 'acquire' | 'query';
  lastErrorCode?: string;
}
const scopes = new AsyncLocalStorage<Measurements>();
const requests = new WeakMap<object, Measurements>();
const bounded = (value: number) => Math.min(1_000_000_000, Math.max(0, value));

export function runSessionDatabaseScope(request: object, next: () => void): void {
  const measurements: Measurements = {
    operation: 'identity.session.resolve',
    calls: 0,
    failures: 0,
    poolAcquireMs: 0,
    queryRoundTripMs: 0,
  };
  requests.set(request, measurements);
  scopes.run(measurements, next);
}

export function sessionDatabaseDiagnostics(request: object): Measurements | undefined {
  const value = requests.get(request);
  return value?.calls
    ? {
        ...value,
        poolAcquireMs: Math.round(value.poolAcquireMs * 10) / 10,
        queryRoundTripMs: Math.round(value.queryRoundTripMs * 10) / 10,
      }
    : undefined;
}

function errorCode(error: unknown, phase: 'acquire' | 'query'): string {
  const value = error as { code?: unknown; message?: unknown } | null;
  if (
    typeof value?.code === 'string' &&
    /^(?:08|22|23|25|28|40|42|53|54|55|57|58|XX)[A-Z0-9]{3}$/.test(value.code)
  )
    return value.code;
  if (
    typeof value?.code === 'string' &&
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(value.code)
  )
    return value.code;
  if (phase === 'query' && value?.message === 'Query read timeout') return 'client_query_timeout';
  if (
    phase === 'acquire' &&
    typeof value?.message === 'string' &&
    /timeout exceeded when trying to connect|timeout exceeded when connecting/.test(value.message)
  )
    return 'pool_acquire_timeout';
  return 'database_error';
}

/** One fixed promise query; do not replace or monkey-patch general pg APIs. */
export const runSessionContextQuery: SessionContextQuery = async (pool, text, values) => {
  const measurements = scopes.getStore();
  if (!measurements) return pool.query(text, values);
  const started = performance.now();
  let acquired: number | undefined;
  let phase: 'acquire' | 'query' = 'acquire';
  let failure: unknown;
  let failed = false;
  try {
    return await new Promise<pg.QueryResult>((resolve, reject) => {
      // Match pg-pool's synchronous checkout handoff: no promise continuation
      // may run between acquisition and installing the client error listener.
      pool.connect((connectError, client) => {
        if (connectError || !client) {
          reject(connectError ?? new Error('database_client_unavailable'));
          return;
        }
        acquired = performance.now();
        phase = 'query';
        let completed = false;
        const finish = (error: unknown, result?: pg.QueryResult) => {
          if (completed) return;
          completed = true;
          client.removeListener('error', onError);
          client.release(error ? (error instanceof Error ? error : true) : undefined);
          if (error) reject(error);
          else resolve(result!);
        };
        const onError = (error: Error) => finish(error);
        client.once('error', onError);
        try {
          client.query(text, values, finish);
        } catch (error) {
          finish(error);
        }
      });
    });
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    // The diagnostic projection can neither replace the query's error nor
    // change its returned rows. No query text/parameters enter request state.
    try {
      const ended = performance.now();
      measurements.calls = bounded(measurements.calls + 1);
      measurements.poolAcquireMs = bounded(
        measurements.poolAcquireMs + (acquired ?? ended) - started,
      );
      if (acquired !== undefined)
        measurements.queryRoundTripMs = bounded(measurements.queryRoundTripMs + ended - acquired);
      if (failed) {
        measurements.failures = bounded(measurements.failures + 1);
        measurements.lastFailurePhase = phase;
        measurements.lastErrorCode = errorCode(failure, phase);
      }
    } catch {
      /* Observation cannot affect authentication. */
    }
  }
};
