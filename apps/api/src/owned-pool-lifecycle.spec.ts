import { EventEmitter } from 'node:events';
import type pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnedPools } from './owned-pool-lifecycle.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('owned pool lifecycle', () => {
  it('deduplicates shared injected pools and handles sanitized idle errors until the pool is closed', async () => {
    const output = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const pool = Object.assign(new EventEmitter(), { end: vi.fn(async () => undefined) });
    const owned = new OwnedPools();
    owned.track(pool as unknown as pg.Pool, 'main');
    owned.track(pool as unknown as pg.Pool, 'analytics');
    pool.emit(
      'error',
      Object.assign(new Error('postgres://password@secret.host'), { code: '08006' }),
    );
    expect(output).toHaveBeenCalledOnce();
    expect(String(output.mock.calls[0]![0])).not.toContain('password');
    expect(String(output.mock.calls[0]![0])).toContain('08006');
    await Promise.all([owned.close(), owned.close()]);
    expect(pool.end).toHaveBeenCalledOnce();
    expect(pool.listenerCount('error')).toBe(0);
  });
  it('still closes the remaining resource if the first end never settles', async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const main = { end: vi.fn(async () => undefined) };
    const stuck = Object.assign(new EventEmitter(), {
      end: vi.fn(() => new Promise<void>(() => undefined)),
    });
    const owned = new OwnedPools();
    owned.track(main as unknown as pg.Pool, 'main');
    owned.track(stuck as unknown as pg.Pool, 'analytics');
    const result = expect(owned.close()).rejects.toThrow('resource_cleanup_failed');
    await vi.advanceTimersByTimeAsync(1_501);
    await result;
    expect(main.end).toHaveBeenCalledOnce();
    expect(stuck.end).toHaveBeenCalledOnce();
    expect(stuck.listenerCount('error')).toBe(1);
    expect(() => stuck.emit('error', new Error('later idle failure'))).not.toThrow();
  });
});
