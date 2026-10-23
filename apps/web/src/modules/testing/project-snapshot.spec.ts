import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  // The production module subscribes at import time only in a browser.
  vi.stubGlobal('window', {});
  return {
    saveProjectSnapshot: vi.fn(),
    loggedOut: undefined as (() => void) | undefined,
  };
});

vi.mock('../../api', () => ({
  api: { saveProjectSnapshot: mocks.saveProjectSnapshot },
}));
vi.mock('../../session-fetch', () => ({
  onSessionLoggedOut: (callback: () => void) => {
    mocks.loggedOut = callback;
  },
}));

import {
  captureProjectSnapshot,
  registerProjectSnapshotSource,
  sendProjectSnapshot,
} from '../project-snapshot';

const canvas = () => ({ width: 640, height: 360 }) as HTMLCanvasElement;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('project snapshot delivery', () => {
  beforeEach(() => {
    mocks.saveProjectSnapshot.mockReset();
    mocks.saveProjectSnapshot.mockResolvedValue({ ok: true, status: 200 });
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
    vi.useRealTimers();
    mocks.loggedOut?.();
    vi.unstubAllGlobals();
  });

  it.each([0, 401, 409, 500])(
    'keeps identical bytes retryable after HTTP %s and deduplicates only success',
    async (status) => {
      mocks.saveProjectSnapshot
        .mockResolvedValueOnce({
          ok: false,
          status,
          error: {
            code: status === 409 ? 'project_revision_conflict' : 'request_failed',
            message: 'Failed',
          },
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
    },
  );

  it('does not capture a canvas while no confirmed revision is available', async () => {
    const capture = vi.fn(() => ({ width: 640, height: 360 }) as HTMLCanvasElement);
    const release = registerProjectSnapshotSource('dirty-project', capture, () => null);

    await expect(sendProjectSnapshot('dirty-project')).resolves.toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(mocks.saveProjectSnapshot).not.toHaveBeenCalled();
    release();
  });

  it.each([0, -1, NaN, 1.5])('rejects invalid confirmed revision %s', async (revision) => {
    const capture = vi.fn(canvas);
    registerProjectSnapshotSource('invalid', capture, () => revision);
    expect(await sendProjectSnapshot('invalid')).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it.each([null, 5])(
    'discards an asynchronous canvas when revision changes to %s',
    async (next) => {
      let revision: number | null = 4;
      const raster = deferred<HTMLCanvasElement>();
      registerProjectSnapshotSource(
        'raster',
        () => raster.promise,
        () => revision,
      );
      const attempt = sendProjectSnapshot('raster');
      revision = next;
      raster.resolve(canvas());
      expect(await attempt).toBe(false);
      expect(mocks.saveProjectSnapshot).not.toHaveBeenCalled();
    },
  );

  it('discards an old registration even when its revision number still matches', async () => {
    const raster = deferred<HTMLCanvasElement>();
    const release = registerProjectSnapshotSource(
      'replaced',
      () => raster.promise,
      () => 4,
    );
    const attempt = sendProjectSnapshot('replaced');
    registerProjectSnapshotSource('replaced', canvas, () => 4);
    release(); // Cleanup from the old editor must not remove the new source.
    raster.resolve(canvas());
    expect(await attempt).toBe(false);
    expect(mocks.saveProjectSnapshot).not.toHaveBeenCalled();
    mocks.saveProjectSnapshot.mockResolvedValue({ ok: true });
    expect(await sendProjectSnapshot('replaced')).toBe(true);
  });

  it('does not publish a capture after unmount or logout', async () => {
    const raster = deferred<HTMLCanvasElement>();
    registerProjectSnapshotSource(
      'logout-capture',
      () => raster.promise,
      () => 4,
    );
    const attempt = captureProjectSnapshot('logout-capture');
    mocks.loggedOut?.();
    raster.resolve(canvas());
    expect(await attempt).toBeNull();
    expect(mocks.saveProjectSnapshot).not.toHaveBeenCalled();
  });

  it('reuploads identical image bytes for a new confirmed draft revision', async () => {
    let revision = 4;
    registerProjectSnapshotSource('new-revision', canvas, () => revision);
    mocks.saveProjectSnapshot.mockResolvedValue({ ok: true });
    expect(await sendProjectSnapshot('new-revision')).toBe(true);
    revision = 5; // A nonvisual edit still changes the immutable card URL.
    expect(await sendProjectSnapshot('new-revision')).toBe(true);
    expect(await sendProjectSnapshot('new-revision')).toBe(false);
    expect(mocks.saveProjectSnapshot.mock.calls.map((call) => call[2])).toEqual([4, 5]);
  });

  it('shares overlapping triggers and releases the slot after the response', async () => {
    const response = deferred<{ ok: boolean }>();
    const capture = vi.fn(canvas);
    registerProjectSnapshotSource('single-flight', capture, () => 4);
    mocks.saveProjectSnapshot.mockReturnValue(response.promise);
    const first = sendProjectSnapshot('single-flight');
    const second = sendProjectSnapshot('single-flight', { unloading: true });
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(mocks.saveProjectSnapshot).toHaveBeenCalledTimes(1);
    response.resolve({ ok: true });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await sendProjectSnapshot('single-flight')).toBe(false);
  });

  it('recovers from a real stale-revision response only after a fresh confirmed capture', async () => {
    let confirmedRevision = 4;
    let databaseRevision = 4;
    const response = deferred<{ ok: boolean; status: number }>();
    registerProjectSnapshotSource('cas-race', canvas, () => confirmedRevision);
    mocks.saveProjectSnapshot.mockImplementationOnce((_project, _image, revision) => {
      databaseRevision += 1; // Another writer commits while this PUT is in flight.
      expect(revision).not.toBe(databaseRevision);
      return response.promise;
    });
    const stale = sendProjectSnapshot('cas-race');
    await Promise.resolve();
    response.resolve({ ok: false, status: 409 });
    expect(await stale).toBe(false);
    // No blind fetch/rebase/retry or invented acknowledgement on conflict.
    expect(mocks.saveProjectSnapshot).toHaveBeenCalledTimes(1);
    confirmedRevision = databaseRevision;
    mocks.saveProjectSnapshot.mockImplementation(async (_project, _image, revision) => ({
      ok: revision === databaseRevision,
      status: revision === databaseRevision ? 200 : 409,
    }));
    expect(await sendProjectSnapshot('cas-race')).toBe(true);
    expect(mocks.saveProjectSnapshot.mock.calls.map((call) => call[2])).toEqual([4, 5]);
  });

  it('never lets a late pre-logout acknowledgement suppress the new identity capture', async () => {
    const oldResponse = deferred<{ ok: boolean }>();
    registerProjectSnapshotSource('late-ack', canvas, () => 4);
    mocks.saveProjectSnapshot.mockReturnValueOnce(oldResponse.promise);
    const old = sendProjectSnapshot('late-ack');
    await Promise.resolve();
    mocks.loggedOut?.();
    registerProjectSnapshotSource('late-ack', canvas, () => 4);
    mocks.saveProjectSnapshot.mockResolvedValue({ ok: true });
    oldResponse.resolve({ ok: true });
    expect(await old).toBe(false);
    expect(await sendProjectSnapshot('late-ack')).toBe(true);
    expect(mocks.saveProjectSnapshot).toHaveBeenCalledTimes(2);
  });

  it('releases single-flight after a thrown transport error so retry remains possible', async () => {
    registerProjectSnapshotSource('throw', canvas, () => 4);
    mocks.saveProjectSnapshot
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true });
    expect(await sendProjectSnapshot('throw')).toBe(false);
    expect(await sendProjectSnapshot('throw')).toBe(true);
  });

  it('releases a stalled capture after its deadline and never publishes its late canvas', async () => {
    vi.useFakeTimers();
    const stalled = deferred<HTMLCanvasElement>();
    const capture = vi.fn().mockReturnValueOnce(stalled.promise).mockImplementation(canvas);
    registerProjectSnapshotSource('stalled', capture, () => 4);
    const attempt = sendProjectSnapshot('stalled');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await attempt).toBe(false);
    expect(mocks.saveProjectSnapshot).not.toHaveBeenCalled();
    expect(await sendProjectSnapshot('stalled')).toBe(true);
    stalled.resolve(canvas());
    await Promise.resolve();
    expect(mocks.saveProjectSnapshot).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
