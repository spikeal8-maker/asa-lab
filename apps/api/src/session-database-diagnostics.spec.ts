import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type pg from 'pg';
import {
  runSessionContextQuery,
  runSessionDatabaseScope,
  sessionDatabaseDiagnostics,
} from './session-database-diagnostics.js';
import { recordServerFailure } from './server-diagnostics.js';

afterEach(() => vi.restoreAllMocks());
const result = { rows: [{ private: 'never logged' }], rowCount: 1 } as unknown as pg.QueryResult;
const scoped = <T>(request: object, run: () => Promise<T>): Promise<T> => {
  let pending!: Promise<T>;
  runSessionDatabaseScope(request, () => {
    pending = run();
  });
  return pending;
};
function fixture() {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const client = Object.assign(new EventEmitter(), {
    release: vi.fn(),
    query: vi.fn().mockImplementation((_sql, _values, callback) => {
      clock = 75;
      callback(null, result);
    }),
  });
  const pool = {
    connect: vi.fn().mockImplementation((callback) => {
      clock = 25;
      callback(null, client);
    }),
    query: vi.fn().mockResolvedValue(result),
  };
  const request = { id: 'request' };
  const run = () =>
    scoped(request, () =>
      runSessionContextQuery(pool as unknown as pg.Pool, 'private SQL', ['private token hash']),
    );
  return {
    client,
    pool,
    request,
    run,
    setTime: (value: number) => {
      clock = value;
    },
  };
}

describe('bounded session context database observations', () => {
  it('separates acquisition and query roundtrip without changing rows or exposing SQL', async () => {
    const f = fixture();
    expect(await f.run()).toBe(result);
    expect(sessionDatabaseDiagnostics(f.request)).toEqual({
      operation: 'identity.session.resolve',
      calls: 1,
      failures: 0,
      poolAcquireMs: 25,
      queryRoundTripMs: 50,
    });
    expect(f.client.release).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(f.client.listenerCount('error')).toBe(0);
    expect(JSON.stringify(sessionDatabaseDiagnostics(f.request))).not.toContain('private');
  });
  it('records acquisition failure without pretending SQL ran', async () => {
    const f = fixture();
    const failure = new Error('timeout exceeded when trying to connect');
    f.pool.connect.mockImplementation((callback) => {
      f.setTime(35);
      callback(failure);
    });
    await expect(f.run()).rejects.toBe(failure);
    expect(sessionDatabaseDiagnostics(f.request)).toMatchObject({
      failures: 1,
      poolAcquireMs: 35,
      queryRoundTripMs: 0,
      lastFailurePhase: 'acquire',
      lastErrorCode: 'pool_acquire_timeout',
    });
    expect(f.client.release).not.toHaveBeenCalled();
    expect(f.client.query).not.toHaveBeenCalled();
  });
  it.each(['callback', 'throw', 'client-error'] as const)(
    'preserves %s failure and releases exactly once',
    async (mode) => {
      const f = fixture();
      const failure = Object.assign(new Error('private SQL and parameters'), { code: '57014' });
      f.client.query.mockImplementation((_sql, _values, callback) => {
        f.setTime(65);
        if (mode === 'throw') throw failure;
        if (mode === 'client-error') f.client.emit('error', failure);
        callback(failure);
      });
      await expect(f.run()).rejects.toBe(failure);
      expect(f.client.release).toHaveBeenCalledExactlyOnceWith(failure);
      expect(f.client.listenerCount('error')).toBe(0);
      expect(sessionDatabaseDiagnostics(f.request)).toEqual({
        operation: 'identity.session.resolve',
        calls: 1,
        failures: 1,
        poolAcquireMs: 25,
        queryRoundTripMs: 40,
        lastFailurePhase: 'query',
        lastErrorCode: '57014',
      });
      expect(JSON.stringify(sessionDatabaseDiagnostics(f.request))).not.toContain('private');
    },
  );
  it('observation failure cannot replace the original database failure', async () => {
    const f = fixture();
    const failure = Object.defineProperty(new Error('private data'), 'code', {
      get() {
        throw new Error('observer failure');
      },
    });
    f.client.query.mockImplementation((_sql, _values, callback) => callback(failure));
    let caught: unknown;
    try {
      await f.run();
    } catch (error) {
      caught = error;
    }
    // The assertion framework itself inspects Error.code; compare identities
    // without invoking the intentionally broken diagnostic getter.
    expect(caught === failure).toBe(true);
    expect(f.client.release.mock.calls.length).toBe(1);
    expect(f.client.release.mock.calls[0]![0] === failure).toBe(true);
  });
  it('handles a client error at checkout before any promise continuation', async () => {
    const f = fixture();
    const failure = Object.assign(new Error('connection lost at handoff'), { code: 'ECONNRESET' });
    let escaped: unknown;
    f.pool.connect.mockImplementation(
      (callback?: (error: null, client: typeof f.client) => void) => {
        f.setTime(25);
        // pg can deliver an error immediately after checkout, before an await
        // continuation. Catch it here solely to keep the old regression from
        // terminating the test runner; production would have no such catch.
        queueMicrotask(() => {
          try {
            f.client.emit('error', failure);
          } catch (error) {
            escaped = error;
          }
        });
        if (callback) callback(null, f.client);
        else return Promise.resolve(f.client);
      },
    );
    f.client.query.mockImplementation((_sql, _values, callback) => {
      f.setTime(75);
      queueMicrotask(() => callback(null, result));
    });
    await expect(f.run()).rejects.toBe(failure);
    expect(escaped).toBeUndefined();
    expect(f.client.release).toHaveBeenCalledExactlyOnceWith(failure);
    expect(sessionDatabaseDiagnostics(f.request)).toMatchObject({
      failures: 1,
      lastFailurePhase: 'query',
      lastErrorCode: 'ECONNRESET',
    });
  });
  it('leaves queries outside HTTP scope on the original pg pool path', async () => {
    const f = fixture();
    expect(await runSessionContextQuery(f.pool as unknown as pg.Pool, 'SQL', ['token'])).toBe(
      result,
    );
    expect(f.pool.query).toHaveBeenCalledExactlyOnceWith('SQL', ['token']);
    expect(f.pool.connect).not.toHaveBeenCalled();
    expect(sessionDatabaseDiagnostics(f.request)).toBeUndefined();
  });
  it('returns a detached bounded projection rather than mutable request state', async () => {
    const f = fixture();
    await f.run();
    const snapshot = sessionDatabaseDiagnostics(f.request)!;
    snapshot.calls = 999;
    expect(sessionDatabaseDiagnostics(f.request)?.calls).toBe(1);
  });
  it('includes the request-bound phase in the actual existing server error log', async () => {
    const f = fixture();
    const failure = Object.assign(new Error('private query'), { code: '57014' });
    f.client.query.mockImplementation((_sql, _values, callback) => callback(failure));
    await expect(f.run()).rejects.toBe(failure);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    recordServerFailure(
      failure,
      Object.assign(f.request, {
        method: 'GET',
        raw: { url: '/api/projects/id' },
        headers: {},
      }) as never,
      500,
      'revision',
      null,
    );
    const log = JSON.parse(String(stdout.mock.calls[0]![0]));
    expect(log.sessionDatabase).toMatchObject({
      operation: 'identity.session.resolve',
      lastFailurePhase: 'query',
      lastErrorCode: '57014',
    });
    expect(log.requestId).toBe('request');
    expect(JSON.stringify(log)).not.toContain('private');
  });
  it('binds overlapping actual Fastify requests across async query callbacks', async () => {
    const app = Fastify();
    const completions = new Map<string, (error: Error | null, rows?: pg.QueryResult) => void>();
    const pool = {
      connect: (callback: (error: null, client: unknown) => void) =>
        callback(
          null,
          Object.assign(new EventEmitter(), {
            release: vi.fn(),
            query: (
              _sql: string,
              values: string[],
              done: (error: Error | null, rows?: pg.QueryResult) => void,
            ) => completions.set(values[0]!, done),
          }),
        ),
    } as unknown as pg.Pool;
    app.addHook('onRequest', (request, _reply, done) => runSessionDatabaseScope(request, done));
    app.get<{ Params: { key: string } }>('/work/:key', async (request) => {
      try {
        await runSessionContextQuery(pool, 'fixed SQL', [request.params.key]);
      } catch {
        /* Return the same diagnostic projection on error for the fixture. */
      }
      return sessionDatabaseDiagnostics(request);
    });
    try {
      const slow = app.inject('/work/slow');
      const failed = app.inject('/work/failed');
      await vi.waitFor(() => expect(completions.size).toBe(2));
      completions.get('failed')!(Object.assign(new Error('private'), { code: '57014' }));
      expect((await failed).json()).toMatchObject({
        calls: 1,
        failures: 1,
        lastErrorCode: '57014',
      });
      completions.get('slow')!(null, result);
      const success = (await slow).json();
      expect(success).toMatchObject({ calls: 1, failures: 0 });
      expect(success.lastErrorCode).toBeUndefined();
      expect(success.lastFailurePhase).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
