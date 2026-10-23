import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../../session-fetch', () => ({ fetchWithSessionRefresh: mocks.fetch }));

import { saveProjectSnapshot } from '../../project-snapshot-client';

describe('snapshot transport cancellation', () => {
  afterEach(() => mocks.fetch.mockReset());

  it('forwards cancellation through the real API client to the transport', async () => {
    const controller = new AbortController();
    let transportAborted = false;
    mocks.fetch.mockImplementation(
      (_path: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          expect(init.signal).toBe(controller.signal);
          expect(init.keepalive).toBe(true);
          init.signal!.addEventListener(
            'abort',
            () => {
              transportAborted = true;
              reject(init.signal!.reason);
            },
            { once: true },
          );
        }),
    );
    const request = saveProjectSnapshot('project', 'image', 4, {
      unloading: true,
      signal: controller.signal,
    });
    controller.abort();
    expect(transportAborted).toBe(true);
    expect(await request).toMatchObject({ ok: false, status: 0 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
