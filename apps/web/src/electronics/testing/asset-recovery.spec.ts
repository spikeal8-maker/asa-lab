/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SchematicComponent } from '../../api';
import { catalogEntry, visualAsset } from '../component-catalog';
import { configureProductionLibrary } from '../production-manifest-adapter';
import {
  createMountedLedAssetBinding,
  ownerSvgSource,
  ProductionComponentVisual,
  type LedAssetPreparation,
  type LedAssetReadiness,
} from '../ProductionComponentVisual';
import {
  createQuietAssetRecovery,
  subscribeSharedQuietAssetRecovery,
  warmProductionAsset,
} from '../production-asset-contracts';

const validSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>';

class SvgParser {
  parseFromString(source: string): Document {
    const valid = source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"');
    return {
      documentElement: {
        localName: valid ? 'svg' : 'html',
        namespaceURI: valid ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml',
      },
      querySelector: () => null,
    } as unknown as Document;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mounted quiet asset recovery', () => {
  it('spreads thirty failed consumers, stops permanently missing assets after three cycles, and cancels on unmount', async () => {
    vi.useFakeTimers();
    let randomIndex = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => ((randomIndex++ * 17) % 31) / 31);
    const requests: number[] = [];
    const consumers = Array.from({ length: 30 }, () =>
      createQuietAssetRecovery(async () => {
        requests.push(Date.now());
        return false;
      }),
    );
    consumers.forEach((consumer) => consumer.failed());
    await vi.advanceTimersByTimeAsync(110_000);
    expect(requests).toHaveLength(90);
    const perSecond = new Map<number, number>();
    for (const at of requests) {
      const second = Math.floor(at / 1_000);
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
    }
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(10);
    await vi.advanceTimersByTimeAsync(110_000);
    expect(requests).toHaveLength(90);

    const cancelled = createQuietAssetRecovery(async () => {
      requests.push(Date.now());
      return false;
    });
    cancelled.failed();
    cancelled.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests).toHaveLength(90);
  });

  it('does not probe a recovered asset again', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let requests = 0;
    const recovery = createQuietAssetRecovery(async () => {
      requests += 1;
      return true;
    });
    recovery.failed();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(requests).toBe(1);
    recovery.failed();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(requests).toBe(2);
    recovery.cancel();
  });

  it('shares a failed asset probe across mounted consumers and cancels after the last unmount', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let requests = 0;
    let notices = 0;
    const retry = async (): Promise<boolean> => {
      requests += 1;
      return requests === 2;
    };
    const first = subscribeSharedQuietAssetRecovery('shared:test', retry, () => {
      notices += 1;
    });
    const second = subscribeSharedQuietAssetRecovery('shared:test', retry, () => {
      notices += 1;
    });
    first.failed();
    second.failed();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests).toBe(2);
    expect(notices).toBe(2);
    first.cancel();
    second.cancel();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(requests).toBe(2);
  });

  it('does not reset the finite budget when a preflight image never loads in its mounted consumer', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let probes = 0;
    let mountedUpdates = 0;
    const recovery = subscribeSharedQuietAssetRecovery(
      'image:mounted-failure',
      async () => {
        probes += 1;
        return 'pending';
      },
      () => {
        mountedUpdates += 1;
      },
    );
    recovery.failed();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(probes).toBe(3);
    expect(mountedUpdates).toBe(3);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(probes).toBe(3);
    recovery.cancel();
  });

  it('keeps retrying a failed mounted image when another consumer of the same asset loads', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let probes = 0;
    const retry = async (): Promise<'pending'> => {
      probes += 1;
      return 'pending';
    };
    const first = subscribeSharedQuietAssetRecovery('image:mixed-outcomes', retry, () => {});
    const second = subscribeSharedQuietAssetRecovery('image:mixed-outcomes', retry, () => {});
    first.failed();
    second.failed();
    first.recovered(); // Its mounted <image> loaded; the second consumer is still failed.
    await vi.advanceTimersByTimeAsync(100_000);
    expect(probes).toBe(3);
    second.recovered();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(probes).toBe(3);
    first.cancel();
    second.cancel();
  });

  it('uses one sparse transport probe to recover an asset after all three quick cycles failed', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let transportReady = false;
    const fetch = vi.fn().mockImplementation(async () => ({ status: transportReady ? 200 : 503 }));
    vi.stubGlobal('fetch', fetch);
    let imageRequests = 0;
    const recovery = createQuietAssetRecovery(async () => {
      imageRequests += 1;
      return transportReady;
    }, '/assets/electronics/late-return.svg');
    recovery.failed();
    await vi.advanceTimersByTimeAsync(75_000);
    expect(imageRequests).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(1);
    transportReady = true;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(imageRequests).toBe(4);
    expect(recovery.permanent()).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    recovery.cancel();
  });

  it('confirms a permanent 404 twice before stopping, but permits a temporary 404 to recover', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let status = 404;
    const fetch = vi.fn().mockImplementation(async () => ({ status }));
    vi.stubGlobal('fetch', fetch);
    const missing = createQuietAssetRecovery(async () => false, '/assets/electronics/missing.svg');
    missing.failed();
    await vi.advanceTimersByTimeAsync(110_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(missing.permanent()).toBe(true);
    await vi.advanceTimersByTimeAsync(110_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    missing.cancel();

    let requests = 0;
    const temporary = createQuietAssetRecovery(async () => {
      requests += 1;
      return status === 200;
    }, '/assets/electronics/temporary.svg');
    temporary.failed();
    await vi.advanceTimersByTimeAsync(75_000);
    expect(temporary.permanent()).toBe(false);
    status = 200;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(requests).toBe(4);
    expect(temporary.permanent()).toBe(false);
    temporary.cancel();
  });

  it('probes one of forty-two failed assets per interval rather than retrying the whole class', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetch = vi.fn().mockResolvedValue({ status: 503 });
    vi.stubGlobal('fetch', fetch);
    const group = Array.from({ length: 42 }, (_, index) =>
      createQuietAssetRecovery(async () => false, `/assets/electronics/group-${index}.svg`),
    );
    group.forEach((recovery) => recovery.failed());
    await vi.advanceTimersByTimeAsync(110_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Set(fetch.mock.calls.map(([asset]) => asset)).size).toBe(2);
    group.forEach((recovery) => recovery.cancel());
    await vi.advanceTimersByTimeAsync(110_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('re-arms forty-two distinct transient assets through one paced queue after transport returns', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let online = false;
    const fetch = vi.fn().mockImplementation(async () => ({ status: online ? 200 : 503 }));
    vi.stubGlobal('fetch', fetch);
    const lateRequests: number[] = [];
    const group = Array.from({ length: 42 }, (_, index) => {
      let requests = 0;
      return createQuietAssetRecovery(async () => {
        requests += 1;
        if (requests > 3) lateRequests.push(Date.now());
        return online;
      }, `/assets/electronics/group-return-${index}.svg`);
    });
    group.forEach((recovery) => recovery.failed());
    await vi.advanceTimersByTimeAsync(75_000);
    expect(lateRequests).toHaveLength(0);
    online = true;
    await vi.advanceTimersByTimeAsync(160_000);
    expect(lateRequests).toHaveLength(42);
    expect(lateRequests.at(-1)! - lateRequests[0]!).toBe(123_000);
    const perSecond = new Map<number, number>();
    for (const at of lateRequests) {
      const second = Math.floor(at / 1_000);
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
    }
    expect(Math.max(...perSecond.values())).toBe(1);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(6);
    group.forEach((recovery) => recovery.cancel());
  });

  it('keeps a 2xx asset eligible after more than three late decode failures', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetch);
    let requests = 0;
    const recovery = createQuietAssetRecovery(
      async () => ++requests >= 8,
      '/assets/decode-return.svg',
    );
    recovery.failed();
    await vi.advanceTimersByTimeAsync(250_000);
    expect(requests).toBe(8);
    expect(recovery.permanent()).toBe(false);
    const probes = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetch).toHaveBeenCalledTimes(probes);
    recovery.cancel();
  });

  it('does not fan out every mounted asset after an isolated 5xx response', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (asset: string) => ({
        status: asset.endsWith('healthy.svg') ? 200 : 503,
      })),
    );
    const requests = [0, 0];
    const healthy = createQuietAssetRecovery(async () => {
      requests[0]! += 1;
      return false;
    }, '/assets/healthy.svg');
    const bad = createQuietAssetRecovery(async () => {
      requests[1]! += 1;
      return false;
    }, '/assets/bad.svg');
    healthy.failed();
    bad.failed();
    await vi.advanceTimersByTimeAsync(135_000);
    expect(requests).toEqual([5, 4]);
    healthy.cancel();
    bad.cancel();
  });

  it('spreads the shared late transport check across thirty simulated browser tabs', async () => {
    vi.useFakeTimers();
    let randomIndex = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => ((randomIndex++ * 17) % 31) / 31);
    let online = false;
    const fetch = vi.fn().mockImplementation(async () => ({ status: online ? 200 : 503 }));
    vi.stubGlobal('fetch', fetch);
    const lateRequests: number[] = [];
    const clients = [];
    for (let index = 0; index < 30; index += 1) {
      // Each separately loaded module is one browser tab with its own shared
      // transport probe and paced re-arm queue.
      vi.resetModules();
      const { createQuietAssetRecovery: createForTab } =
        await import('../production-asset-contracts');
      let requests = 0;
      const client = createForTab(async () => {
        requests += 1;
        if (requests > 3) lateRequests.push(Date.now());
        return online;
      }, `/assets/electronics/class-${index}.svg`);
      client.failed();
      clients.push(client);
    }
    await vi.advanceTimersByTimeAsync(120_000);
    online = true;
    await vi.advanceTimersByTimeAsync(140_000);
    expect(lateRequests).toHaveLength(30);
    const perSecond = new Map<number, number>();
    for (const at of lateRequests) {
      const second = Math.floor(at / 1_000);
      perSecond.set(second, (perSecond.get(second) ?? 0) + 1);
    }
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(5);
    clients.forEach((client) => client.cancel());
  });

  it('does not mistake an unsupported HEAD for permanent 404', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetch = vi.fn().mockImplementation(async (asset: string, options: RequestInit) => ({
      status: asset === '/assets/no-head.svg' && options.method === 'HEAD' ? 405 : 200,
    }));
    vi.stubGlobal('fetch', fetch);
    let requests = 0;
    const recovery = createQuietAssetRecovery(async () => ++requests > 3, '/assets/no-head.svg');
    recovery.failed();
    await vi.advanceTimersByTimeAsync(80_000);
    expect(fetch.mock.calls.map(([, options]) => options.method ?? 'GET')).toEqual(['HEAD', 'GET']);
    expect(requests).toBe(4);
    expect(recovery.permanent()).toBe(false);
    recovery.cancel();
  });
});

describe('production owner SVG text recovery', () => {
  it('deduplicates consumers, retries a failed fetch, and reuses the validated success', async () => {
    vi.stubGlobal('DOMParser', SvgParser);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, text: async () => validSvg });
    vi.stubGlobal('fetch', fetch);
    const asset = '/assets/electronics/recovery-dedup.svg';
    const first = ownerSvgSource(asset);
    expect(ownerSvgSource(asset)).toBe(first);
    expect(await first).toBe(validSvg);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await ownerSvgSource(asset)).toBe(validSvg);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects successful HTTP with invalid SVG and permits a later recovery event', async () => {
    vi.stubGlobal('DOMParser', SvgParser);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>bad asset</html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>bad asset</html>' })
      .mockResolvedValueOnce({ ok: true, text: async () => '<html>bad asset</html>' })
      .mockResolvedValue({ ok: true, text: async () => validSvg });
    vi.stubGlobal('fetch', fetch);
    const asset = '/assets/electronics/recovery-invalid.svg';
    await expect(ownerSvgSource(asset)).rejects.toThrow('not valid SVG');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await ownerSvgSource(asset)).toBe(validSvg);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('terminates a hung fetch after a bounded cycle without further automatic requests', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('DOMParser', SvgParser);
    const fetch = vi.fn().mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetch);
    const pending = ownerSvgSource('/assets/electronics/recovery-hang.svg');
    const failure = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('production state-image warmup', () => {
  it('deduplicates a hung image and releases the warmup slot after timeout', async () => {
    vi.useFakeTimers();
    const requests: string[] = [];
    class TestImage {
      decoding = '';
      naturalWidth = 10;
      naturalHeight = 10;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        requests.push(value);
      }
    }
    vi.stubGlobal('window', { Image: TestImage, setTimeout, clearTimeout });
    const asset = '/assets/electronics/recovery-warmup.svg';
    warmProductionAsset(asset);
    warmProductionAsset(asset);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_500);
    warmProductionAsset(asset);
    expect(requests).toHaveLength(2);
  });
});

// Induced commit-to-passive delivery proves the production lifecycle contract;
// it does not establish native race frequency or the old CI failure's cause.
describe('ordinary image mount lifecycle', () => {
  const mounted: (() => void)[] = [];
  afterEach(() => {
    for (const unmount of mounted.splice(0)) unmount();
  });
  function mount() {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    configureProductionLibrary(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            'apps/web/public/assets/electronics/component-database/catalog.json',
          ),
          'utf8',
        ),
      ),
    );
    const entry = catalogEntry('battery-holder-aa-2')!;
    const probes: { href: string; error: () => void; load: () => void }[] = [];
    class ProbeImage {
      naturalWidth = 10;
      naturalHeight = 10;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      set src(href: string) {
        probes.push({ href, error: () => this.onerror?.(), load: () => this.onload?.() });
        if (!href.includes('pending'))
          queueMicrotask(() => (href.includes('success') ? this.onload?.() : this.onerror?.()));
      }
    }
    vi.stubGlobal('Image', ProbeImage);
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    function Consumer({ asset, events }: { asset: string; events: readonly string[] }) {
      useLayoutEffect(() => {
        const image = host.querySelector('image')!;
        for (const kind of events) image.dispatchEvent(new Event(kind));
      }, [asset, events]);
      return createElement(
        'svg',
        {},
        createElement(ProductionComponentVisual, {
          entry: { ...entry, asset },
          component: {
            id: 'early',
            kind: entry.kind,
            componentTypeId: entry.key,
            position: { x: 0, y: 0 },
            value: entry.defaultValue,
            rotation: 0,
            stateProperties: {},
          },
          width: 100,
          height: 100,
          visualState: 'default',
        }),
      );
    }
    let unmounted = false;
    const unmount = () => {
      if (!unmounted) {
        unmounted = true;
        act(() => root.unmount());
        host.remove();
      }
    };
    mounted.push(unmount);
    return {
      host,
      probes,
      unmount,
      render: async (asset: string, events: readonly string[]) => {
        await act(async () => root.render(createElement(Consumer, { asset, events })));
      },
      advance: async (ms: number) => {
        await act(async () => vi.advanceTimersByTimeAsync(ms));
      },
    };
  }
  it('replays an error delivered before passive setup once through the finite shared recovery', async () => {
    const fixture = mount();
    await fixture.render('/assets/electronics/early-mount-test.svg', ['error']);
    await fixture.advance(1_500);
    expect(fixture.probes).toHaveLength(3);
    expect(fixture.host.querySelector('[data-owner-image-status="failed"]')).not.toBeNull();
    expect(fixture.host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
      'Изображение детали не загрузилось',
    );
  });
  it('lets a later early load supersede an early error without inventing failure or recovery requests', async () => {
    const fixture = mount();
    await fixture.render('/assets/electronics/early-load-last.svg', ['error', 'load']);
    await fixture.advance(40_000);
    expect(fixture.probes).toHaveLength(0);
    expect(fixture.host.querySelector('[data-owner-image-status="failed"]')).toBeNull();
  });
  it('keeps a new resource early event through old cleanup and ignores old completed recovery', async () => {
    const fixture = mount();
    await fixture.render('/assets/electronics/pending-old-switch.svg', ['error']);
    expect(fixture.probes).toHaveLength(1);
    await fixture.render('/assets/electronics/success-new-switch.svg', ['error']);
    expect(fixture.probes).toHaveLength(2);
    expect(fixture.probes[1]!.href).toContain('success-new-switch.svg');
    await act(async () => fixture.probes[0]!.load());
    await fixture.advance(100);
    expect(fixture.host.querySelector('image')!.getAttribute('href')).toContain(
      'success-new-switch.svg',
    );
    expect(fixture.host.querySelector('[data-owner-image-status="failed"]')).toBeNull();
  });
  it('does not publish or schedule quiet recovery after the consumer unmounts', async () => {
    const fixture = mount();
    await fixture.render('/assets/electronics/pending-unmounted.svg', ['error']);
    fixture.unmount();
    await act(async () => fixture.probes[0]!.error());
    await fixture.advance(40_000);
    // The already started shared finite decode can finish, but no mounted
    // listener schedules another quiet cycle or commits a consumer state.
    expect(fixture.probes).toHaveLength(3);
    expect(fixture.host.childNodes).toHaveLength(0);
  });
  it('publishes both consumers after B errors between finite cycle one and the quiet retry', async () => {
    const asset = '/assets/electronics/two-consumer-before-quiet.svg';
    const first = mount();
    await first.render(asset, ['error']);
    await first.advance(1_500);
    expect(first.probes).toHaveLength(3);
    expect(first.host.querySelector('[data-owner-image-status="failed"]')).not.toBeNull();

    const late = mount();
    await late.render(asset, ['error']);
    expect(late.probes).toHaveLength(1);
    await late.advance(1_500);
    for (const consumer of [first, late]) {
      expect(consumer.host.querySelector('image')!.getAttribute('href')).toBe(asset);
      expect(consumer.host.querySelector('[data-owner-image-status="failed"]')).not.toBeNull();
      expect(consumer.host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
        'Изображение детали не загрузилось',
      );
    }
    expect(late.probes).toHaveLength(3);
    expect(
      [...first.probes, ...late.probes].map(({ href }) => {
        const url = new URL(href);
        expect(url.pathname).toBe(asset);
        return [url.searchParams.get('asa-image-cycle'), url.searchParams.get('asa-image-retry')];
      }),
    ).toEqual([
      ['1', '0'],
      ['1', '1'],
      ['1', '2'],
      ['2', '0'],
      ['2', '1'],
      ['2', '2'],
    ]);
    // Both finite cycles settled before A's first quiet retry (at 3600 ms).
    // Unmounting both consumers must cancel that retry, not start a third cycle.
    first.unmount();
    late.unmount();
    await late.advance(40_000);
    expect(first.probes).toHaveLength(3);
    expect(late.probes).toHaveLength(3);
  });

  it('publishes B own error while it joins A pending quiet cycle two without another cycle', async () => {
    const asset = '/assets/electronics/pending-two-consumer-quiet.svg';
    const first = mount();
    await first.render(asset, ['error']);
    await act(async () => first.probes[0]!.error());
    await first.advance(200);
    await act(async () => first.probes[1]!.error());
    await first.advance(400);
    await act(async () => first.probes[2]!.error());
    expect(first.probes).toHaveLength(3);
    expect(first.host.querySelector('[data-owner-image-status="failed"]')).not.toBeNull();
    await first.advance(3_000);
    expect(first.probes).toHaveLength(4);
    const pending = new URL(first.probes[3]!.href);
    expect(pending.pathname).toBe(asset);
    expect(pending.searchParams.get('asa-image-cycle')).toBe('2');
    expect(pending.searchParams.get('asa-image-retry')).toBe('0');

    const late = mount();
    await late.render(asset, ['error']);
    expect(late.probes).toHaveLength(0);
    expect(late.host.querySelector('image')!.getAttribute('href')).toBe(asset);
    // B's mounted error has joined the still-pending shared promise, before it settles.
    await act(async () => first.probes[3]!.error());
    await late.advance(200);
    await act(async () => late.probes[0]!.error());
    await late.advance(400);
    await act(async () => late.probes[1]!.error());
    for (const consumer of [first, late]) {
      expect(consumer.host.querySelector('image')!.getAttribute('href')).toBe(asset);
      expect(consumer.host.querySelector('[data-owner-image-status="failed"]')).not.toBeNull();
      expect(consumer.host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
        'Изображение детали не загрузилось',
      );
    }
    expect(
      [...first.probes, ...late.probes].map(({ href }) => {
        const url = new URL(href);
        expect(url.pathname).toBe(asset);
        return [url.searchParams.get('asa-image-cycle'), url.searchParams.get('asa-image-retry')];
      }),
    ).toEqual([
      ['1', '0'],
      ['1', '1'],
      ['1', '2'],
      ['2', '0'],
      ['2', '1'],
      ['2', '2'],
    ]);
    first.unmount();
    late.unmount();
    await late.advance(40_000);
    expect(first.probes).toHaveLength(4);
    expect(late.probes).toHaveLength(2);
  });
  it.each(['before passive setup', 'after passive setup'])(
    'publishes a late consumer error %s after shared recovery permanently stops without restarting requests',
    async (delivery) => {
      const asset = `/assets/electronics/late-permanent-${delivery.replaceAll(' ', '-')}.svg`;
      const first = mount();
      const fetch = vi.fn().mockResolvedValue({ status: 404 });
      vi.stubGlobal('fetch', fetch);
      await first.render(asset, ['error']);
      await first.advance(140_000);
      expect(first.probes).toHaveLength(12);
      expect(fetch).toHaveBeenCalledTimes(2);
      const witness = subscribeSharedQuietAssetRecovery(
        `image:${asset}`,
        async () => false,
        () => {},
      );
      expect(witness.permanent()).toBe(true);
      witness.cancel();

      const late = mount();
      await late.render(asset, delivery === 'before passive setup' ? ['error'] : []);
      if (delivery === 'after passive setup') {
        expect(late.host.querySelector('[role="status"]')).toBeNull();
        await act(async () => late.host.querySelector('image')!.dispatchEvent(new Event('error')));
      }
      expect(late.host.querySelector('image')!.getAttribute('href')).toBe(asset);
      expect(late.host.querySelector('[data-owner-image-status="failed"]')).not.toBeNull();
      expect(late.host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
        'Изображение детали не загрузилось',
      );
      await late.advance(65_000);
      expect(first.host.querySelector('[data-owner-image-status="failed"]')).not.toBeNull();
      expect(late.host.querySelector('[data-owner-image-status="failed"]')).not.toBeNull();
      expect(first.probes).toHaveLength(12);
      expect(late.probes).toHaveLength(0);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});

describe('mounted LED resource leases', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
  function mountBinding(asset = '/assets/electronics/lease-a.svg') {
    const svg = document.body.appendChild(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    );
    const parent = svg.appendChild(document.createElementNS(svg.namespaceURI, 'g'));
    const image = parent.appendChild(
      document.createElementNS(svg.namespaceURI, 'image'),
    ) as SVGImageElement;
    image.setAttribute('href', asset);
    image.setAttribute('class', 'workbench-led-asset');
    image.style.opacity = '0';
    const changed = vi.fn();
    const binding = createMountedLedAssetBinding(changed);
    const key = {};
    binding.bind(image, asset, asset, key);
    cleanups.push(() => {
      binding.bind(null, asset, asset, key);
      svg.remove();
    });
    return { svg, parent, image, binding, key, changed, asset };
  }

  it('requires the connected body node native callback, then distinguishes ready from active', () => {
    const fixture = mountBinding();
    const { binding, image, key, asset, parent } = fixture;
    const request = { token: 'generation-1:frame-1', asset };
    expect(binding.lease(request, 'led', () => true)).toBeNull();
    expect(binding.native('load', { target: image, isTrusted: false }, key)).toBe(false);
    const selectionCopy = image.cloneNode() as SVGImageElement;
    parent.appendChild(selectionCopy);
    expect(binding.native('load', { target: selectionCopy, isTrusted: true }, key)).toBe(false);
    expect(binding.lease(request, 'led', () => true)).toBeNull();
    image.remove();
    expect(binding.native('load', { target: image, isTrusted: true }, key)).toBe(false);
    parent.prepend(image);
    // These are induced callback records, not evidence of browser-native paint.
    expect(binding.native('load', { target: image, isTrusted: true }, key)).toBe(true);
    const lease = binding.lease(request, 'led', () => true)!;
    expect(lease.element).toBe(image);
    expect(lease.href).toBe(asset);
    expect(lease.isCurrent()).toBe(true);
    expect(lease.isActive()).toBe(false);
    image.setAttribute('data-led-asset-active', 'true');
    image.setAttribute('data-led-asset-token', request.token);
    image.style.opacity = '1';
    expect(lease.isActive()).toBe(true);
    parent.prepend(selectionCopy);
    expect(lease.isActive()).toBe(false);
    parent.prepend(image);
    expect(lease.isActive()).toBe(true);
    image.style.opacity = '0';
    expect(lease.isActive()).toBe(false);
  });

  it('revokes an issued lease on href A→B→A, native error and lifecycle cancellation', () => {
    const { binding, image, key, asset } = mountBinding();
    const request = { token: 'generation-1:frame-1', asset };
    let current = true;
    binding.native('load', { target: image, isTrusted: true }, key);
    const first = binding.lease(request, 'led', () => current)!;
    image.setAttribute('href', '/assets/electronics/other.svg');
    image.setAttribute('href', asset);
    // takeRecords must catch even a restored href before the observer callback.
    expect(first.isCurrent()).toBe(false);
    expect(binding.lease(request, 'led', () => current)).toBeNull();
    binding.native('load', { target: image, isTrusted: true }, key);
    const repaired = binding.lease(request, 'led', () => current)!;
    expect(repaired.bindingRevision).toBeGreaterThan(first.bindingRevision);
    expect(repaired.isCurrent()).toBe(true);
    binding.native('error', { target: image, isTrusted: true }, key);
    expect(repaired.isCurrent()).toBe(false);
    expect(binding.state()?.failed).toBe(true);
    binding.native('load', { target: image, isTrusted: true }, key);
    const recovered = binding.lease(request, 'led', () => current)!;
    expect(recovered.isCurrent()).toBe(true);
    current = false;
    expect(recovered.isCurrent()).toBe(false);
    expect(recovered.isActive()).toBe(false);
  });

  it('rejects old ref cleanup and callbacks when a permanent node is rebound A→B→A', () => {
    const { binding, image, key, asset } = mountBinding();
    binding.native('load', { target: image, isTrusted: true }, key);
    const old = binding.lease({ token: 'old', asset }, 'led', () => true)!;
    const secondKey = {};
    const thirdKey = {};
    const nextAsset = '/assets/electronics/lease-b.svg';
    image.setAttribute('href', nextAsset);
    binding.bind(image, nextAsset, nextAsset, secondKey);
    image.setAttribute('href', asset);
    binding.bind(image, asset, asset, thirdKey);
    binding.bind(null, asset, asset, key);
    expect(binding.state()?.element).toBe(image);
    expect(binding.native('load', { target: image, isTrusted: true }, key)).toBe(false);
    expect(binding.native('load', { target: image, isTrusted: true }, secondKey)).toBe(false);
    expect(old.isCurrent()).toBe(false);
    expect(binding.lease({ token: 'new', asset }, 'led', () => true)).toBeNull();
    expect(binding.native('load', { target: image, isTrusted: true }, thirdKey)).toBe(true);
    const current = binding.lease({ token: 'new', asset }, 'led', () => true)!;
    binding.native('load', { target: image, isTrusted: true }, thirdKey);
    expect(current.isCurrent()).toBe(true);
    binding.bind(null, asset, asset, thirdKey);
    expect(current.isCurrent()).toBe(false);
  });
});

// JSDOM does not load SVG images or deliver trusted browser events. The adapter
// invokes the actual React-installed native callback with an induced record;
// no event is dispatched, no Event.isTrusted property or production hook is
// changed. These tests establish node/lease/commit contracts only. Unchanged
// browser observers and native captures remain the visible-result gate.
describe('resident LED body preparation and joint DOM commit', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
  function nativeCallback(image: SVGImageElement, kind: 'load' | 'error') {
    const key = Object.getOwnPropertyNames(image).find((name) => name.startsWith('__reactProps$'));
    if (!key) throw new Error('React did not install native image event props');
    const props = (image as unknown as Record<string, unknown>)[key] as Record<string, unknown>;
    const callback = props[kind === 'load' ? 'onLoad' : 'onError'];
    if (typeof callback !== 'function')
      throw new Error(`Mounted image has no native ${kind} callback`);
    return () => callback({ nativeEvent: { target: image, isTrusted: true } });
  }
  const loadCallback = (image: SVGImageElement) => nativeCallback(image, 'load');
  function BeforeRendererLayout({ callback }: { callback: (() => void) | undefined }) {
    useLayoutEffect(() => {
      callback?.();
    }, [callback]);
    return null;
  }
  function fixture() {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    configureProductionLibrary(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            'apps/web/public/assets/electronics/component-database/catalog.json',
          ),
          'utf8',
        ),
      ),
    );
    const led = catalogEntry('led-5mm')!;
    const arduino = catalogEntry('arduino-uno')!;
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    const events: LedAssetReadiness[] = [];
    const onReadiness = (event: LedAssetReadiness) => events.push(event);
    let state: {
      brightness: number;
      running: boolean;
      id: string;
      colour: string;
      fault: string;
      prepared: LedAssetPreparation | undefined;
      committed: LedAssetReadiness | undefined;
      rollback: LedAssetReadiness | undefined;
    } = {
      brightness: 0,
      running: true,
      id: 'resident-led',
      colour: 'red',
      fault: 'none',
      prepared: undefined,
      committed: undefined,
      rollback: undefined,
    };
    type View = typeof state;
    type Boundary = {
      beforeLayout: (() => void) | undefined;
      previous: { brightness: number; lease: LedAssetReadiness } | undefined;
    };
    const boundaryOutcomes: string[] = [];
    const component = (view: View = state): SchematicComponent => ({
      id: view.id,
      kind: led.kind,
      componentTypeId: led.key,
      position: { x: 0, y: 0 },
      value: led.defaultValue,
      rotation: 0,
      stateProperties: { ledColour: view.colour, ledFault: view.fault },
    });
    const asset = (brightness: number) =>
      visualAsset(
        led,
        {
          ...component(),
          stateProperties: { ...component().stateProperties, ledBrightness: brightness },
        },
        brightness > 0 ? 'lit' : 'off',
      );
    function BoundaryHost({ source, boundary }: { source: View; boundary: Boundary | undefined }) {
      const [decision, setDecision] = useState<{ source: View; view: View } | null>(null);
      const shown = decision?.source === source ? decision.view : source;
      useLayoutEffect(() => {
        if (!boundary || decision?.source === source) return;
        if (source.committed?.isCurrent() && source.committed.isActive()) {
          boundaryOutcomes.push('ack');
          // ACK explicitly releases rollback ownership in a synchronous commit.
          setDecision({ source, view: { ...source, rollback: undefined } });
          return;
        }
        const previous = boundary.previous;
        const restorable = previous?.lease.isCurrent() === true;
        boundaryOutcomes.push(restorable ? 'rollback' : 'clear');
        setDecision({
          source,
          view: {
            ...source,
            brightness: restorable && previous ? previous.brightness : 0,
            committed: restorable && previous ? previous.lease : undefined,
            rollback: undefined,
          },
        });
      }, [boundary, decision, source]);
      return createElement(
        'svg',
        {},
        createElement(BeforeRendererLayout, { callback: boundary?.beforeLayout }),
        createElement(
          'g',
          { 'data-testid': 'external-led' },
          createElement(ProductionComponentVisual, {
            entry: led,
            component: component(shown),
            width: 40,
            height: 60,
            visualState: shown.brightness > 0 ? 'lit' : 'off',
            effectiveBrightness: shown.brightness,
            simulationRunning: shown.running,
            preparedLedAsset: shown.prepared,
            committedLedAsset: shown.committed,
            rollbackLedAsset: shown.rollback,
            onLedAssetReadiness: onReadiness,
          }),
        ),
        createElement(ProductionComponentVisual, {
          entry: arduino,
          component: {
            id: 'uno',
            kind: arduino.kind,
            componentTypeId: arduino.key,
            position: { x: 0, y: 0 },
            value: arduino.defaultValue,
            rotation: 0,
            stateProperties: {},
          },
          width: 240,
          height: 180,
          visualState: 'default',
          simulationRunning: shown.running,
          effectiveArduinoLActive: shown.brightness > 0,
        }),
      );
    }
    const render = async (patch: Partial<typeof state> = {}, boundary?: Boundary) => {
      state = { ...state, ...patch };
      await act(async () => root.render(createElement(BoundaryHost, { source: state, boundary })));
    };
    const images = () => [
      ...host.querySelectorAll<SVGImageElement>(
        '[data-testid="external-led"] image.workbench-led-asset',
      ),
    ];
    const imageFor = (href: string) => {
      const image = images().find((image) => image.getAttribute('href') === href);
      if (!image) throw new Error(`Resident body image is missing: ${href}`);
      return image;
    };
    const ready = (token: string) => {
      const event = [...events]
        .reverse()
        .find((event) => event.token === token && event.status === 'ready');
      if (!event) throw new Error(`Native ready lease is missing: ${token}`);
      return event;
    };
    const load = async (image: SVGImageElement) => {
      await act(async () => loadCallback(image)());
    };
    const lActive = () =>
      host.querySelector('[data-testid="arduino-led-l"]')?.getAttribute('opacity');
    cleanups.push(() => {
      act(() => root.unmount());
      host.remove();
    });
    return {
      host,
      events,
      render,
      asset,
      images,
      imageFor,
      ready,
      load,
      lActive,
      boundaryOutcomes,
    };
  }

  it('recovers a failed stopped fault preview on its mounted body without issuing a simulation lease', async () => {
    const probes: string[] = [];
    class RetryImage {
      naturalWidth = 10;
      naturalHeight = 10;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(href: string) {
        probes.push(href);
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', RetryImage);
    const f = fixture();
    await f.render({ running: false });
    const offAsset = f.asset(0);
    const off = f.imageFor(offAsset);
    await f.load(off);
    await f.render({ fault: 'reverse', brightness: 70 });
    const faultAsset = f.asset(0);
    expect(faultAsset).toMatch(/led_red_reverse_polarity\.svg$/);
    const preview = f.imageFor(faultAsset);
    expect(f.images()[0]).toBe(preview);
    expect(f.images()).toHaveLength(2);
    expect(preview.getAttribute('data-led-asset-token')).toBeNull();
    // Induce the mounted error delivered for an invalid HTTP image body.
    // The unchanged browser test supplies the actual HTTP 200 HTML response.
    await act(async () => nativeCallback(preview, 'error')());
    expect(probes).toHaveLength(1);
    const retry = new URL(probes[0]!);
    expect(retry.pathname).toBe(faultAsset);
    expect(retry.searchParams.get('asa-image-retry')).toBe('0');
    expect(f.images()[0]).toBe(preview);
    expect(preview.getAttribute('href')).toBe(retry.href);
    await f.load(preview);
    expect(f.imageFor(offAsset)).toBe(off);
    expect(f.events.filter((event) => event.status === 'ready')).toHaveLength(0);
    expect(f.host.querySelector('.workbench-led-visual')?.getAttribute('data-led-brightness')).toBe(
      '0',
    );
    expect(f.host.querySelector('.workbench-led-visual')?.classList.contains('is-lit')).toBe(false);
    expect(f.lActive()).toBe('0');
  });

  it('keeps stopped previews out of Run admission and returns to resident OFF on Stop despite stale brightness', async () => {
    const f = fixture();
    await f.render({ running: false });
    const offAsset = f.asset(0);
    const highAsset = f.asset(70);
    const off = f.imageFor(offAsset);
    await f.render({ fault: 'burned' });
    const preview = f.imageFor(f.asset(0));
    await f.load(preview);
    const latePreviewLoad = loadCallback(preview);
    const request = { token: 'preview-to-run:high', asset: highAsset };
    await f.render({ running: true, fault: 'none', prepared: request });
    expect(f.images()[0]).toBe(off);
    const high = f.imageFor(highAsset);
    await f.load(high);
    await act(async () => latePreviewLoad());
    expect(f.events.filter((event) => event.status === 'ready')).toHaveLength(0);
    await f.load(off);
    const lease = f.ready(request.token);
    expect(lease.isCurrent()).toBe(true);
    expect(lease.isActive()).toBe(false);
    await f.render({ brightness: 70, committed: lease });
    expect(f.images()[0]).toBe(high);
    expect(lease.isActive()).toBe(true);
    await f.render({ running: false, prepared: undefined, committed: undefined });
    expect(f.images()[0]).toBe(off);
    expect(off.getAttribute('href')).toBe(offAsset);
    expect(lease.isCurrent()).toBe(false);
    expect(f.images().length).toBeLessThanOrEqual(3);
    expect(f.host.querySelector('.workbench-led-visual')?.getAttribute('data-led-brightness')).toBe(
      '0',
    );
    expect(f.host.querySelector('.workbench-led-visual')?.classList.contains('is-lit')).toBe(false);
    expect(f.lActive()).toBe('0');
    await f.render({ fault: 'burned' });
    expect(f.images()[0]).toBe(f.imageFor(f.asset(0)));
    // A stopped preview never becomes the fallback for a revoked running lease.
    await f.render({ running: true, brightness: 0, fault: 'none', committed: lease });
    expect(lease.isCurrent()).toBe(false);
    expect(f.images()[0]).toBe(off);
    expect(f.lActive()).toBe('0');
  });

  it('waits for native OFF and HIGH, then moves the loaded keyed node with the same href in a joint LED/L commit', async () => {
    const f = fixture();
    const request = { token: 'g1:high', asset: f.asset(70) };
    await f.render({ prepared: request });
    const off = f.imageFor(f.asset(0));
    const high = f.imageFor(request.asset);
    const highHref = high.getAttribute('href');
    expect(f.images()).toHaveLength(2);
    expect(f.images()[0]).toBe(off);
    expect(f.lActive()).toBe('0');
    await f.load(high);
    expect(f.events.filter((event) => event.status === 'ready')).toHaveLength(0);
    await f.load(off);
    const lease = f.ready(request.token);
    expect(lease.isCurrent()).toBe(true);
    expect(lease.isActive()).toBe(false);
    expect(f.images()[0]).toBe(off);
    expect(f.lActive()).toBe('0');
    await f.render({ brightness: 70, committed: lease });
    expect(f.images()[0]).toBe(high);
    expect(high.getAttribute('href')).toBe(highHref);
    expect(f.imageFor(f.asset(0))).toBe(off);
    expect(lease.isCurrent()).toBe(true);
    expect(lease.isActive()).toBe(true);
    expect(f.lActive()).toBe('1');
    expect(f.host.querySelector('.workbench-led-visual')?.classList.contains('is-lit')).toBe(true);
    expect(f.host.querySelector('.workbench-led-visual')?.getAttribute('data-led-brightness')).toBe(
      '70',
    );
    const offRequest = { token: 'g1:off', asset: f.asset(0) };
    await f.render({ prepared: offRequest });
    expect(lease.isCurrent()).toBe(true);
    expect(lease.isActive()).toBe(true);
    const offLease = f.ready(offRequest.token);
    await f.render({ brightness: 0, committed: offLease });
    expect(f.images()[0]).toBe(off);
    expect(offLease.isActive()).toBe(true);
    expect(f.lActive()).toBe('0');
    expect(f.images()).toHaveLength(2);
  });

  it('bounds arbitrary brightness to OFF+active+pending without evicting active or accepting its old native handler', async () => {
    const f = fixture();
    const first = { token: 'g1:first', asset: f.asset(70) };
    await f.render({ prepared: first });
    const off = f.imageFor(f.asset(0));
    const high = f.imageFor(first.asset);
    const oldHighLoad = loadCallback(high);
    await f.load(off);
    await f.load(high);
    const highLease = f.ready(first.token);
    await f.render({ brightness: 70, committed: highLease });
    const middle = { token: 'g1:middle', asset: f.asset(40) };
    await f.render({ prepared: middle });
    const middleNode = f.imageFor(middle.asset);
    expect(f.images()).toHaveLength(3);
    expect(f.images()[0]).toBe(high);
    expect(highLease.isCurrent()).toBe(true);
    await f.load(middleNode);
    const middleLease = f.ready(middle.token);
    await f.render({ brightness: 40, committed: middleLease });
    const last = { token: 'g1:last', asset: f.asset(90) };
    await f.render({ prepared: last });
    expect(f.images()).toHaveLength(3);
    expect(f.images()[0]).toBe(middleNode);
    expect(f.imageFor(last.asset)).toBe(high);
    expect(f.imageFor(f.asset(0))).toBe(off);
    expect(highLease.isCurrent()).toBe(false);
    expect(middleLease.isCurrent()).toBe(true);
    await act(async () => oldHighLoad());
    expect(f.events.some((event) => event.token === last.token && event.status === 'ready')).toBe(
      false,
    );
    expect(f.images()[0]).toBe(middleNode);
    await f.load(high);
    const lastLease = f.ready(last.token);
    await f.render({ brightness: 90, committed: lastLease });
    expect(f.images()[0]).toBe(high);
    expect(lastLease.isActive()).toBe(true);
    expect(f.images()).toHaveLength(3);
    await f.render({ running: false, brightness: 0, prepared: undefined, committed: undefined });
    expect(f.images()[0]).toBe(off);
    expect(off.getAttribute('href')).toBe(f.asset(0));
    expect(lastLease.isCurrent()).toBe(false);
    expect(f.lActive()).toBe('0');
  });

  it('keeps Reset OFF resident, rejects cancelled or forged leases, and fences a new component/colour lineage', async () => {
    const f = fixture();
    const request = { token: 'g1:high', asset: f.asset(70) };
    await f.render({ prepared: request });
    const off = f.imageFor(f.asset(0));
    const high = f.imageFor(request.asset);
    await f.load(off);
    await f.load(high);
    const old = f.ready(request.token);
    await f.render({ brightness: 70, committed: old });
    await f.render({ brightness: 0, prepared: undefined, committed: undefined });
    expect(f.images()[0]).toBe(off);
    expect(f.lActive()).toBe('0');
    expect(old.isCurrent()).toBe(false);
    const next = { token: 'g2:high', asset: request.asset };
    await f.render({ prepared: next });
    const current = f.ready(next.token);
    expect(current.element).toBe(high);
    expect(current.isCurrent()).toBe(true);
    expect(old.isCurrent()).toBe(false);
    await f.render({
      brightness: 70,
      committed: { ...old, isCurrent: () => true, isActive: () => true },
    });
    expect(f.images()[0]).toBe(off);
    expect(current.isActive()).toBe(false);
    await f.render({ brightness: 70, committed: current });
    expect(current.isActive()).toBe(true);
    await f.render({
      id: 'replacement-led',
      colour: 'blue',
      brightness: 0,
      prepared: undefined,
      committed: undefined,
    });
    expect(current.isCurrent()).toBe(false);
    expect(off.isConnected).toBe(false);
    expect(high.isConnected).toBe(false);
    expect(f.images()).toHaveLength(1);
    expect(f.images()[0]?.getAttribute('href')).toBe(f.asset(0));
    expect(f.lActive()).toBe('0');
  });

  it.each([
    { previous: 0, next: 70, invalidation: 'native error before child layout' },
    { previous: 70, next: 40, invalidation: 'native error before child layout' },
    { previous: 0, next: 70, invalidation: 'href mutation flushed inside child layout' },
    { previous: 70, next: 40, invalidation: 'href mutation flushed inside child layout' },
  ])(
    'restores $previous from rejected $next after $invalidation in the parent layout commit',
    async ({ previous, next, invalidation }) => {
      vi.useFakeTimers();
      const f = fixture();
      const first = { token: 'g1:accepted', asset: f.asset(previous) };
      await f.render({ prepared: first });
      const off = f.imageFor(f.asset(0));
      const previousNode = f.imageFor(first.asset);
      await f.load(off);
      if (previousNode !== off) await f.load(previousNode);
      const previousLease = f.ready(first.token);
      await f.render({ brightness: previous, committed: previousLease });
      const proposed = { token: 'g1:proposed', asset: f.asset(next) };
      await f.render({ prepared: proposed });
      const proposedNode = f.imageFor(proposed.asset);
      await f.load(proposedNode);
      const proposedLease = f.ready(proposed.token);
      expect(previousLease.isActive()).toBe(true);
      expect(proposedLease.isCurrent()).toBe(true);
      let selectedBeforeInvalidation = false;
      const beforeLayout = () => {
        // All native DOM mutations have committed; this earlier sibling layout
        // runs before the actual resource pool's layout and the parent ACK.
        selectedBeforeInvalidation = f.images()[0] === proposedNode;
        if (invalidation.startsWith('native error')) nativeCallback(proposedNode, 'error')();
        else {
          proposedNode.setAttribute('href', `${proposed.asset}?induced-intervening-resource`);
          proposedNode.setAttribute('href', proposed.asset);
          // Do not read a lease here: the production child layout must itself
          // flush the pending A→B→A mutation and reject that native proof.
        }
      };
      await f.render(
        { brightness: next, committed: proposedLease, rollback: previousLease },
        {
          beforeLayout,
          previous: { brightness: previous, lease: previousLease },
        },
      );
      expect(selectedBeforeInvalidation).toBe(true);
      expect(f.boundaryOutcomes).toEqual(['rollback']);
      expect(f.images()[0]).toBe(previousNode);
      expect(previousNode.getAttribute('href')).toBe(first.asset);
      expect(previousLease.isCurrent()).toBe(true);
      expect(previousLease.isActive()).toBe(true);
      expect(proposedLease.isCurrent()).toBe(false);
      expect(f.lActive()).toBe(previous > 0 ? '1' : '0');
      expect(
        f.host.querySelector('.workbench-led-visual')?.getAttribute('data-led-brightness'),
      ).toBe(String(previous));
      expect(f.host.querySelector('.workbench-led-visual')?.classList.contains('is-lit')).toBe(
        previous > 0,
      );
      expect(f.images().length).toBeLessThanOrEqual(3);
    },
  );

  it('protects the rollback node until an explicit parent layout ACK releases it, without waiting for a later render', async () => {
    const f = fixture();
    const first = { token: 'g1:a', asset: f.asset(70) };
    await f.render({ prepared: first });
    const off = f.imageFor(f.asset(0));
    const firstNode = f.imageFor(first.asset);
    await f.load(off);
    await f.load(firstNode);
    const firstLease = f.ready(first.token);
    await f.render({ brightness: 70, committed: firstLease });
    const second = { token: 'g1:b', asset: f.asset(40) };
    await f.render({ prepared: second });
    const secondNode = f.imageFor(second.asset);
    await f.load(secondNode);
    const secondLease = f.ready(second.token);
    // The new native node is rendered, but no parent ACK has happened yet.
    await f.render({ brightness: 40, committed: secondLease, rollback: firstLease });
    const third = { token: 'g1:c', asset: f.asset(90) };
    await f.render({ prepared: third });
    expect(firstLease.isCurrent()).toBe(true);
    expect(secondLease.isActive()).toBe(true);
    expect(f.images()[0]).toBe(secondNode);
    expect(f.imageFor(first.asset)).toBe(firstNode);
    expect(f.images().some((image) => image.getAttribute('href') === third.asset)).toBe(false);
    expect(f.images()).toHaveLength(3);
    await f.render(
      {},
      { beforeLayout: undefined, previous: { brightness: 70, lease: firstLease } },
    );
    // No additional fixture render: the parent layout's explicit release must
    // have committed already and made the old inactive slot reusable.
    expect(f.boundaryOutcomes).toEqual(['ack']);
    expect(firstLease.isCurrent()).toBe(false);
    expect(secondLease.isActive()).toBe(true);
    expect(f.images()[0]).toBe(secondNode);
    expect(secondNode.getAttribute('href')).toBe(second.asset);
    expect(f.imageFor(third.asset)).toBe(firstNode);
    expect(f.imageFor(f.asset(0))).toBe(off);
    expect(f.images()).toHaveLength(3);
    expect(f.events.some((event) => event.token === third.token && event.status === 'ready')).toBe(
      false,
    );
  });

  it('clears the complete optical vector if both proposed and previous native resources fail before ACK', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const first = { token: 'g1:a', asset: f.asset(70) };
    await f.render({ prepared: first });
    const off = f.imageFor(f.asset(0));
    const firstNode = f.imageFor(first.asset);
    await f.load(off);
    await f.load(firstNode);
    const firstLease = f.ready(first.token);
    await f.render({ brightness: 70, committed: firstLease });
    const second = { token: 'g1:b', asset: f.asset(40) };
    await f.render({ prepared: second });
    const secondNode = f.imageFor(second.asset);
    await f.load(secondNode);
    const secondLease = f.ready(second.token);
    await f.render(
      { brightness: 40, committed: secondLease, rollback: firstLease },
      {
        beforeLayout: () => {
          nativeCallback(firstNode, 'error')();
          nativeCallback(secondNode, 'error')();
        },
        previous: { brightness: 70, lease: firstLease },
      },
    );
    expect(f.boundaryOutcomes).toEqual(['clear']);
    expect(firstLease.isCurrent()).toBe(false);
    expect(secondLease.isCurrent()).toBe(false);
    expect(f.images()[0]).toBe(off);
    expect(f.lActive()).toBe('0');
    expect(f.host.querySelector('.workbench-led-visual')?.getAttribute('data-led-brightness')).toBe(
      '0',
    );
    expect(f.host.querySelector('.workbench-led-visual')?.classList.contains('is-lit')).toBe(false);
  });

  it.each(['Stop', 'Reset'])(
    'cancels every pending/committed/rollback lease on %s and rejects their later load callbacks',
    async (action) => {
      const f = fixture();
      const first = { token: 'g1:a', asset: f.asset(70) };
      await f.render({ prepared: first });
      const off = f.imageFor(f.asset(0));
      const firstNode = f.imageFor(first.asset);
      await f.load(off);
      await f.load(firstNode);
      const firstLease = f.ready(first.token);
      await f.render({ brightness: 70, committed: firstLease });
      const second = { token: 'g1:b', asset: f.asset(40) };
      await f.render({ prepared: second });
      const secondNode = f.imageFor(second.asset);
      await f.load(secondNode);
      const secondLease = f.ready(second.token);
      await f.render({ brightness: 40, committed: secondLease, rollback: firstLease });
      const delayedLoad = loadCallback(firstNode);
      await f.render({
        running: action === 'Reset',
        brightness: 0,
        prepared: undefined,
        committed: undefined,
        rollback: undefined,
      });
      expect(f.images()[0]).toBe(off);
      expect(firstLease.isCurrent()).toBe(false);
      expect(secondLease.isCurrent()).toBe(false);
      await act(async () => delayedLoad());
      // A stray rollback-only prop cannot reactivate a cancelled generation.
      await f.render({ rollback: firstLease });
      expect(firstLease.isCurrent()).toBe(false);
      expect(secondLease.isCurrent()).toBe(false);
      expect(f.images()[0]).toBe(off);
      expect(f.lActive()).toBe('0');
    },
  );
});
