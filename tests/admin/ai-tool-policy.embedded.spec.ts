import { publishFixtureModels } from './ai-model-policy.fixture';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { AiImageService } from '../../apps/api/src/ai-image.service';
import { AiToolPolicyService, TOOL_IDS } from '../../apps/api/src/ai-tool-policy';

let db: PGlite;
const client = () => ({
  query: async (sql: string, params?: unknown[]) =>
    params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
});
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
async function identity(admin = false) {
  const account = (
    await db.query<{ id: string }>(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test','1990-01-01','RU') RETURNING id",
      [randomUUID() + '@example.test'],
    )
  ).rows[0]!.id;
  const owner = (
    await db.query<{ id: string }>(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [account],
    )
  ).rows[0]!.id;
  if (admin)
    await db.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','admin-stage-a-2026-08','admin')",
      [account],
    );
  return owner;
}
const rules = (enabled = true) =>
  TOOL_IDS.map((id) => ({
    id,
    enabled,
    instructions: id === 'weather' ? 'Показывай дату прогноза.' : '',
  }));

beforeAll(async () => {
  db = new PGlite();
  await applyPlan(client(), planMigrations('migrations'));
}, 30000);
afterAll(async () => db?.close());

it('requires platform admin and applies CAS, exact replay and rejection of mismatched request reuse', async () => {
  const admin = await identity(true),
    stranger = await identity();
  const service = new AiToolPolicyService(pool);
  expect((await service.admin(admin)).policy.configurationVersion).toBe(1);
  const dto = await new AiChatService(pool).toolPolicyAdmin(admin);
  expect(dto).toMatchObject({ schemaVersion: 1, configurationVersion: 1 });
  expect(dto.tools.map((item) => item.id)).toEqual(TOOL_IDS);
  expect(
    dto.tools.every(
      (item) =>
        item.available === false && typeof item.reason === 'string' && item.hardLimits.length > 0,
    ),
  ).toBe(true);
  await expect(service.admin(stranger)).rejects.toMatchObject({ code: '42501' });
  const requestId = randomUUID();
  const input = {
    schemaVersion: 1,
    expectedConfigurationVersion: 1,
    requestId,
    tools: rules(false),
  };
  expect((await service.save(admin, input)).configurationVersion).toBe(2);
  expect((await service.save(admin, input)).configurationVersion).toBe(2);
  expect(
    (
      await service.save(admin, {
        ...input,
        expectedConfigurationVersion: 2,
        requestId: randomUUID(),
        tools: rules(true),
      })
    ).configurationVersion,
  ).toBe(3);
  expect((await service.save(admin, input)).configurationVersion).toBe(2);
  await expect(service.save(admin, { ...input, tools: rules(true) })).rejects.toMatchObject({
    code: 'ai_tool_policy_invalid',
  });
  await expect(service.save(admin, { ...input, requestId: randomUUID() })).rejects.toMatchObject({
    code: 'ai_tool_policy_changed',
  });
  await expect(
    service.save(stranger, { ...input, requestId: randomUUID(), expectedConfigurationVersion: 3 }),
  ).rejects.toMatchObject({ code: '42501' });
});

it('freezes the admitted parent policy and blocks disabled manual web lookup before provider fetch', async () => {
  const admin = await identity(true),
    owner = await identity();
  const policy = new AiToolPolicyService(pool);
  const before = (await policy.admin(admin)).policy.configurationVersion;
  await policy.save(admin, {
    schemaVersion: 1,
    expectedConfigurationVersion: before,
    requestId: randomUUID(),
    tools: rules(false),
  });
  const fetchImpl = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).includes('api.deepseek.com')) {
      const body = JSON.parse(String(options?.body));
      return body.stream
        ? new Response(
            'data: ' +
              JSON.stringify({
                choices: [{ delta: { content: 'Нет свежих источников' }, finish_reason: 'stop' }],
              }) +
              '\n\ndata: [DONE]\n\n',
          )
        : new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Нет свежих источников' }, finish_reason: 'stop' }],
            }),
          );
    }
    throw new Error('Disabled search reached provider');
  });
  const chat = new AiChatService(pool, { encryptionKey: '4c'.repeat(32), fetchImpl });
  await chat.saveAdminConfig(
    admin,
    {
      enabled: true,
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKey: 'test-llm-only-key',
      paidOperationsPerHour: 100,
    },
    randomUUID(),
  );
  await publishFixtureModels(chat, admin, ['deepseek-flash']);
  const thread = await chat.createThread(owner),
    request = randomUUID();
  await chat.sendStream(
    owner,
    thread.id,
    'Найди факт',
    request,
    () => undefined,
    new AbortController().signal,
    undefined,
    undefined,
    [],
    'web',
  );
  const saved = await policy.snapshot(owner, thread.id, request);
  expect(saved.tools.every((item) => !item.enabled)).toBe(true);
  const imageRequest = randomUUID();
  expect(await policy.manualImageAllowed(owner, thread.id, imageRequest)).toBe(false);
  await expect(
    new AiImageService(pool).create(owner, thread.id, {
      requestId: imageRequest,
      prompt: 'A classroom globe',
      size: 768,
    }),
  ).rejects.toMatchObject({ code: 'ai_image_not_admitted' });
  expect(
    (
      await db.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM ai_image_jobs WHERE owner_principal_id=$1 AND request_id=$2',
        [owner, imageRequest],
      )
    ).rows[0]?.count,
  ).toBe('0');
  const nextVersion = (await policy.admin(admin)).policy.configurationVersion;
  await policy.save(admin, {
    schemaVersion: 1,
    expectedConfigurationVersion: nextVersion,
    requestId: randomUUID(),
    tools: rules(true),
  });
  expect(
    (await policy.snapshot(owner, thread.id, request)).tools.every((item) => !item.enabled),
  ).toBe(true);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
