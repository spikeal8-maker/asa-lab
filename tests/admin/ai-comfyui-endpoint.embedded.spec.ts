import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { ComfyUiSettings, comfyUiRuntimeOrigin } from '../../apps/api/src/ai-comfyui-settings';
import { AiImageService } from '../../apps/api/src/ai-image.service';
import { ComfyImageTransport } from '../../apps/api/src/ai-image-comfyui';
let db: PGlite, admin: string, owner: string;
const pool = {
  query: async (sql: string, params: unknown[] = []) => {
    await db.exec('SET ROLE asalab_app');
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec('RESET ROLE');
    }
  },
} as unknown as pg.Pool;
async function identity(elevated = false) {
  const account = (
    await db.query<{ id: string }>(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test','1990-01-01','RU') RETURNING id",
      [randomUUID() + '@example.test'],
    )
  ).rows[0]!.id;
  const principal = (
    await db.query<{ id: string }>(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [account],
    )
  ).rows[0]!.id;
  if (elevated)
    await db.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
      [account],
    );
  return principal;
}
const probeFetch = vi.fn<typeof fetch>(async (url) => {
  const path = new URL(String(url)).pathname;
  return new Response(
    JSON.stringify(
      path === '/system_stats'
        ? {
            system: { comfyui_version: '0.19.3' },
            devices: [{ name: 'RTX 3060', vram_total: 12 * 1024 ** 3 }],
          }
        : path.endsWith('/diffusion_models')
          ? ['flux-2-klein-4b-fp8.safetensors']
          : path.endsWith('/text_encoders')
            ? ['qwen_3_4b.safetensors']
            : ['flux2-vae.safetensors'],
    ),
  );
});
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(
    {
      query: async (sql: string, params?: unknown[]) =>
        params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
    },
    planMigrations('migrations'),
  );
  admin = await identity(true);
  owner = await identity();
}, 30000);
afterAll(async () => db?.close());
it('saves a private remote origin with CAS and audit, preserving unrelated image controls and using GET-only probes', async () => {
  const settings = new ComfyUiSettings(pool, probeFetch);
  await expect(settings.config(owner)).rejects.toMatchObject({ code: '42501' });
  const before = await settings.config(admin),
    requestId = randomUUID();
  const imageBefore = (await pool.query('SELECT ai_image_config($1) AS value', [admin])).rows;
  const input = {
    configurationVersion: before.configurationVersion,
    baseUrl: 'http://192.168.12.20:8188',
    requestId,
  };
  const saved = await settings.save(admin, input);
  expect(saved.config).toMatchObject({
    baseUrl: input.baseUrl,
    configurationVersion: 2,
    source: 'saved',
  });
  expect(saved.status.recipeReady).toBe(false);
  expect(saved.status.devices[0]?.vramTotalBytes).toBe(12 * 1024 ** 3);
  expect(
    probeFetch.mock.calls.every(([, init]) => init?.method === 'GET' && init.redirect === 'error'),
  ).toBe(true);
  expect((await pool.query('SELECT ai_image_config($1) AS value', [admin])).rows).toEqual(
    imageBefore,
  );
  expect(await comfyUiRuntimeOrigin(pool, { ASA_COMFYUI_BASE_URL: 'http://127.0.0.1:9999' })).toBe(
    input.baseUrl,
  );
  await settings.save(admin, input);
  expect((await settings.config(admin)).configurationVersion).toBe(2);
  await expect(settings.save(admin, { ...input, requestId: randomUUID() })).rejects.toMatchObject({
    status: 409,
  });
  await expect(pool.query('SELECT comfy_base_url FROM ai_image_settings')).rejects.toMatchObject({
    code: '42501',
  });
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM administrative_audit_events WHERE action='administration.comfyui.endpoint'",
      )
    ).rows[0],
  ).toEqual({ n: 1 });
});
it('rejects public/metadata/credential destinations before network access and in SQL', async () => {
  const settings = new ComfyUiSettings(pool, probeFetch);
  const before = probeFetch.mock.calls.length;
  for (const url of [
    'http://8.8.8.8:8188',
    'http://169.254.169.254:8188',
    'http://user:secret@192.168.1.1:8188',
    'http://192.168.1.1:8188/other',
  ])
    await expect(settings.probe(admin, url)).rejects.toMatchObject({
      code: 'ai_comfy_url_invalid',
    });
  expect(probeFetch.mock.calls).toHaveLength(before);
  await expect(
    pool.query('SELECT ai_comfyui_config_set($1,$2,$3::varchar,$4::uuid)', [
      admin,
      2,
      'http://8.8.8.8:8188',
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '22023' });
});
it('uses the saved remote origin for dispatch and recovery and refuses switching while a durable job is unresolved', async () => {
  await db.exec('UPDATE ai_image_settings SET enabled=true');
  const thread = (await pool.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [owner]))
    .rows[0]!.id;
  const fetchImpl = vi.fn<typeof fetch>(
    async (url, init) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/prompt')
            ? { prompt_id: JSON.parse(String(init?.body)).prompt_id, node_errors: {} }
            : String(url).includes('/history/')
              ? {}
              : { queue_running: [], queue_pending: [] },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetchImpl);
  const ready = vi
    .spyOn(ComfyImageTransport.prototype, 'readiness')
    .mockResolvedValue({ ready: true, reason: null });
  try {
    const blobs = { putImmutable: vi.fn(), verify: vi.fn(), read: vi.fn(), remove: vi.fn() };
    const service = new AiImageService(pool, { blobs, maintenance: false });
    const id = randomUUID();
    await service.create(owner, thread, { requestId: id, prompt: 'Blue vase', size: 768 });
    await service.sweep();
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    expect(
      fetchImpl.mock.calls.every(([url]) => String(url).startsWith('http://192.168.12.20:8188/')),
    ).toBe(true);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/prompt'))).toHaveLength(1);
    const settings = new ComfyUiSettings(pool, probeFetch);
    await expect(
      settings.save(admin, {
        configurationVersion: 2,
        baseUrl: 'http://192.168.12.21:8188',
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'ai_comfy_jobs_active', status: 409 });
    expect((await settings.config(admin)).baseUrl).toBe('http://192.168.12.20:8188');
  } finally {
    ready.mockRestore();
    vi.unstubAllGlobals();
  }
});
