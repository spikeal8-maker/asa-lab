import { describe, expect, it } from 'vitest';
import { createChessSaveQueue } from '../use-chess-project';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('Chess save queue', () => {
  it('finishes an older autosave before sending the newer manual save', async () => {
    const queue = createChessSaveQueue();
    const firstResponse = deferred<string>();
    const started: string[] = [];

    const olderAutosave = queue.run(async () => {
      started.push('older');
      return firstResponse.promise;
    });
    const newerManualSave = queue.run(async () => {
      started.push('newer');
      return 'four plies';
    });

    await Promise.resolve();
    expect(started).toEqual(['older']);
    firstResponse.resolve('three plies');

    await expect(olderAutosave).resolves.toBe('three plies');
    await expect(newerManualSave).resolves.toBe('four plies');
    expect(started).toEqual(['older', 'newer']);
  });

  it('continues after a failed save so the newest document can still win', async () => {
    const queue = createChessSaveQueue();
    const failed = queue.run(async () => {
      throw new Error('network');
    });
    const recovered = queue.run(async () => 'latest document');

    await expect(failed).rejects.toThrow('network');
    await expect(recovered).resolves.toBe('latest document');
  });
});
