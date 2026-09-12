import { describe, expect, it } from 'vitest';
import {
  createCheckersSaveQueue,
  readStoredCheckersBotPlayerSide,
  writeStoredCheckersBotPlayerSide,
} from '../use-checkers-project';

describe('Checkers autosave queue', () => {
  it('serializes writes and continues after a rejected request', async () => {
    const queue = createCheckersSaveQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          events.push('first:start');
          releaseFirst = () => {
            events.push('first:end');
            resolve();
          };
        }),
    );
    const second = queue.run(async () => {
      events.push('second:start');
      throw new Error('network');
    });
    const third = queue.run(async () => {
      events.push('third:start');
      return 'saved';
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst?.();
    await first;
    await expect(second).rejects.toThrow('network');
    await expect(third).resolves.toBe('saved');
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'third:start']);
  });
});
describe('Checkers bot-side resume preference', () => {
  it('stores and restores only valid player sides', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readStoredCheckersBotPlayerSide(storage, 'project-1')).toBeNull();
    writeStoredCheckersBotPlayerSide(storage, 'project-1', 'dark');
    expect(readStoredCheckersBotPlayerSide(storage, 'project-1')).toBe('dark');

    values.set('asa-lab:checkers:project-1:bot-player-side', 'broken');
    expect(readStoredCheckersBotPlayerSide(storage, 'project-1')).toBeNull();
  });
});
