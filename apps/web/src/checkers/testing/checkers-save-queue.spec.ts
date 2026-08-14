import { describe, expect, it } from 'vitest';
import { createCheckersSaveQueue } from '../use-checkers-project';

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
