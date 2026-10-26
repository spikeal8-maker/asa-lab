import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';
import { PublicScratchPlayerService, publicScratchDocument } from './public-scratch-player.js';
import { BlocksRuntimeCapabilityService } from './blocks-runtime-capability.js';
import { publicScratchFixture } from './testing/fixtures/public-scratch';
const ORIGIN = 'http://127.0.0.1:4612';
const env = {
  ASA_BLOCKS_RUNTIME_ORIGIN: ORIGIN,
  ASA_BLOCKS_RUNTIME_SIGNING_KEY: '0123456789abcdef'.repeat(4),
};
function fixture() {
  const input = publicScratchFixture();
  let visible = true;
  const query = vi.fn(async (sql: string, args: string[]) => ({
    rows: !visible
      ? []
      : sql.includes('player_source')
        ? [{ document_json: input.document }]
        : args[2] === input.ref.assetId && args[3] === input.ref.dataFormat
          ? [
              {
                tenant_id: randomUUID(),
                asset_id: input.ref.assetId,
                data_format: 'svg',
                sha256: input.ref.sha256,
                size_bytes: String(input.bytes.length),
              },
            ]
          : [],
  }));
  const open = vi.fn(async () =>
    (async function* () {
      yield input.bytes;
    })(),
  );
  let now = 1000000;
  const service = new PublicScratchPlayerService({ query } as unknown as pg.Pool, env, {
    blobs: { open } as never,
    now: () => now,
  });
  const binding = { publicationId: randomUUID(), revisionId: randomUUID() };
  return {
    input,
    query,
    open,
    service,
    binding,
    hide: () => {
      visible = false;
    },
    expire: () => {
      now += 601000;
    },
  };
}
describe('public Scratch player authority', () => {
  it('queues fifteen pupils with four parallel assets each and drains with bounded work', async () => {
    const f = fixture();
    const b = await f.service.issue(f.binding);
    let active = 0,
      peak = 0;
    f.open.mockImplementation(async () =>
      (async function* () {
        active++;
        peak = Math.max(peak, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 2));
          yield f.input.bytes;
        } finally {
          active--;
        }
      })(),
    );
    await Promise.all(
      Array.from({ length: 60 }, async () => {
        const item = await f.service.asset(
          f.binding,
          b.runtimeToken,
          ORIGIN,
          f.input.ref.assetId,
          'svg',
        );
        try {
          for await (const chunk of item.body) expect(chunk).toEqual(f.input.bytes);
        } finally {
          item.release();
        }
      }),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(f.open).toHaveBeenCalledTimes(60);
  });
  it('aborts a waiting request and releases never-consumed output on client close without leaking a slot', async () => {
    const f = fixture();
    const b = await f.service.issue(f.binding);
    const clients = Array.from({ length: 4 }, () => new AbortController());
    const held = await Promise.all(
      clients.map((client) =>
        f.service.asset(
          f.binding,
          b.runtimeToken,
          ORIGIN,
          f.input.ref.assetId,
          'svg',
          client.signal,
        ),
      ),
    );
    const controller = new AbortController();
    const pending = f.service.asset(
      f.binding,
      b.runtimeToken,
      ORIGIN,
      f.input.ref.assetId,
      'svg',
      controller.signal,
    );
    const rejected = expect(pending).rejects.toMatchObject({ status: 503 });
    controller.abort();
    await rejected;
    clients.forEach((client) => client.abort());
    expect((await f.service.issue(f.binding)).projectJson).toEqual(f.input.document.projectJson);
    held.forEach((item) => {
      item.release();
      item.release();
    });
  });
  it('times out the bounded FIFO, then expires never-consumed outputs and admits new work', async () => {
    const f = fixture();
    const b = await f.service.issue(f.binding);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const held = await Promise.all(
        Array.from({ length: 4 }, () =>
          f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.input.ref.assetId, 'svg'),
        ),
      );
      const rejected = expect(
        f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.input.ref.assetId, 'svg'),
      ).rejects.toMatchObject({ status: 503 });
      // JWT verification is asynchronous: advance only after the FIFO deadline is actually armed.
      await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(4));
      await vi.advanceTimersByTimeAsync(5001);
      await rejected;
      await vi.advanceTimersByTimeAsync(30000);
      expect((await f.service.issue(f.binding)).projectJson).toEqual(f.input.document.projectJson);
      held.forEach((item) => item.release());
    } finally {
      vi.useRealTimers();
    }
  });
  it('never returns bytes when the object body has incorrect size or digest', async () => {
    const f = fixture();
    const b = await f.service.issue(f.binding);
    for (const bad of [Buffer.from('short'), Buffer.alloc(f.input.bytes.length, 0)]) {
      f.open.mockImplementation(async () =>
        (async function* () {
          yield bad;
        })(),
      );
      await expect(
        f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.input.ref.assetId, 'svg'),
      ).rejects.toMatchObject({ status: 503 });
    }
    f.open.mockImplementation(async () =>
      (async function* () {
        yield Buffer.concat([f.input.bytes, Buffer.from('overflow')]);
      })(),
    );
    await expect(
      f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.input.ref.assetId, 'svg'),
    ).rejects.toBeTruthy();
  });
  it('issues only public claims and independently validates real canonical Scratch structure', async () => {
    const f = fixture();
    const bootstrap = await f.service.issue(f.binding);
    expect(bootstrap.projectJson).toEqual(f.input.document.projectJson);
    const payload = JSON.parse(
      Buffer.from(bootstrap.runtimeToken.split('.')[1]!, 'base64url').toString(),
    );
    expect(payload).toMatchObject({
      ...f.binding,
      mode: 'public-player',
      aud: 'asa-public-scratch-player',
    });
    for (const key of ['tenantId', 'principalId', 'projectId', 'versionId', 'sub', 'permissions'])
      expect(payload).not.toHaveProperty(key);
    expect(bootstrap).not.toHaveProperty('objectKey');
    expect((await f.service.verify(f.binding, bootstrap.runtimeToken, ORIGIN)).jti).toBeTruthy();
  });
  it('rechecks visibility before cached bootstrap and asset bytes', async () => {
    const f = fixture();
    const b = await f.service.issue(f.binding);
    f.hide();
    await expect(f.service.issue(f.binding)).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.input.ref.assetId, 'svg'),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.open).not.toHaveBeenCalled();
  });
  it('streams only an exact authorized asset without exposing storage identity', async () => {
    const f = fixture();
    const b = await f.service.issue(f.binding);
    const asset = await f.service.asset(
      f.binding,
      b.runtimeToken,
      ORIGIN,
      f.input.ref.assetId,
      'svg',
    );
    const buffers = [];
    for await (const bytes of asset.body) buffers.push(bytes);
    asset.release();
    expect(Buffer.concat(buffers)).toEqual(f.input.bytes);
    expect(asset).not.toHaveProperty('tenant_id');
    await expect(
      f.service.asset(f.binding, b.runtimeToken, ORIGIN, f.input.ref.assetId, 'png'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects cross publication/revision/origin, tampering and expiry', async () => {
    const f = fixture();
    const b = await f.service.issue(f.binding);
    await expect(
      f.service.verify({ ...f.binding, revisionId: randomUUID() }, b.runtimeToken, ORIGIN),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.verify({ ...f.binding, publicationId: randomUUID() }, b.runtimeToken, ORIGIN),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.verify(f.binding, b.runtimeToken, 'http://evil.test'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(f.service.verify(f.binding, b.runtimeToken + 'x', ORIGIN)).rejects.toMatchObject({
      status: 404,
    });
    f.expire();
    await expect(f.service.verify(f.binding, b.runtimeToken, ORIGIN)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('does not accept editor capabilities and public capabilities cannot authorize editor writes', async () => {
    const f = fixture();
    const b = await f.service.issue(f.binding);
    const editor = new BlocksRuntimeCapabilityService({
      key: Buffer.from(env.ASA_BLOCKS_RUNTIME_SIGNING_KEY, 'hex'),
      runtimeOrigin: ORIGIN,
      authority: { allows: async () => true },
    });
    const binding = {
      tenantId: randomUUID(),
      principalId: randomUUID(),
      projectId: randomUUID(),
      versionId: null,
      mode: 'editor' as const,
    };
    const issued = await editor.issue(binding);
    if (!issued.ok) throw Error();
    await expect(f.service.verify(f.binding, issued.value.token, ORIGIN)).rejects.toMatchObject({
      status: 404,
    });
    for (const permission of [
      'asset:write',
      'draft:write',
      'snapshot:write',
      'asset:read',
    ] as const)
      expect(
        await editor.verify({ token: b.runtimeToken, origin: ORIGIN, binding, permission }),
      ).toMatchObject({ ok: false });
  });
  it('preserves official builtins and rejects custom URL extensions, extension metadata and oversize JSON', async () => {
    const f = publicScratchFixture();
    for (const extension of ['https://evil.test/extension.js', 'custom-extension']) {
      const d = structuredClone(f.document);
      (d.projectJson.extensions as unknown[]).push(extension);
      await expect(publicScratchDocument(d)).rejects.toBeTruthy();
    }
    // The VM can infer an extension from opcode families even when extensions[] is empty.
    for (const opcode of ['https://evil.test/extension.js_run', 'customextension_run']) {
      const hidden = structuredClone(f.document);
      hidden.projectJson.targets[0]!.blocks.start.opcode = opcode;
      expect(hidden.projectJson.extensions).toEqual([]);
      await expect(publicScratchDocument(hidden)).rejects.toBeTruthy();
    }
    const native = structuredClone(f.document);
    (native.projectJson.extensions as unknown[]).push('microbit', 'videoSensing', 'translate');
    expect((await publicScratchDocument(native)).projectJson!.extensions).toEqual([
      'microbit',
      'videoSensing',
      'translate',
    ]);
    const d = structuredClone(f.document);
    Object.assign(d.projectJson, { extensionURLs: { pen: 'https://evil.test' } });
    await expect(publicScratchDocument(d)).rejects.toBeTruthy();
    await expect(
      publicScratchDocument({ ...f.document, unknown: 'x'.repeat(5 * 1024 * 1024) }),
    ).rejects.toBeTruthy();
    await expect(publicScratchDocument({ ...f.document, assets: [] })).rejects.toBeTruthy();
  });
});
