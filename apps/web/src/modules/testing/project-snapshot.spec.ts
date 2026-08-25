import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveProjectSnapshot: vi.fn(),
}));

vi.mock('../../api', () => ({
  api: { saveProjectSnapshot: mocks.saveProjectSnapshot },
}));

import { registerProjectSnapshotSource, sendProjectSnapshot } from '../project-snapshot';

describe('project snapshot delivery', () => {
  beforeEach(() => {
    mocks.saveProjectSnapshot.mockReset();
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: '',
          fillRect: vi.fn(),
          drawImage: vi.fn(),
        }),
        toDataURL: () => 'data:image/webp;base64,c25hcHNob3Q=',
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries identical bytes after a transient failure and deduplicates only success', async () => {
    mocks.saveProjectSnapshot
      .mockResolvedValueOnce({
        ok: false,
        status: 0,
        error: { code: 'network', message: 'offline' },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { snapshot: {} } });
    const release = registerProjectSnapshotSource(
      'retry-project',
      () => ({ width: 640, height: 360 }) as HTMLCanvasElement,
      () => 4,
    );

    await expect(sendProjectSnapshot('retry-project')).resolves.toBe(false);
    await expect(sendProjectSnapshot('retry-project')).resolves.toBe(true);
    await expect(sendProjectSnapshot('retry-project')).resolves.toBe(false);
    expect(mocks.saveProjectSnapshot).toHaveBeenCalledTimes(2);
    release();
  });

  it('does not capture a canvas while no confirmed revision is available', async () => {
    const capture = vi.fn(() => ({ width: 640, height: 360 }) as HTMLCanvasElement);
    const release = registerProjectSnapshotSource('dirty-project', capture, () => null);

    await expect(sendProjectSnapshot('dirty-project')).resolves.toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(mocks.saveProjectSnapshot).not.toHaveBeenCalled();
    release();
  });
});
