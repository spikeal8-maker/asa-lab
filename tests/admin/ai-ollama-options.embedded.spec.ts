import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
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
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(client(), planMigrations('migrations'));
}, 30000);
afterAll(async () => db?.close());

it('persists options with the same revision, denies non-admin and rejects stale or invalid writes', async () => {
  const admin = await identity(true),
    stranger = await identity();
  const service = new AiChatService(pool);
  const initial = await service.ollamaSettings(admin);
  expect(initial).toMatchObject({ thinking: 'default', contextTokens: 65536 });
  const input = { ...initial, thinking: 'xhigh', contextTokens: 120000 };
  await expect(service.saveOllamaSettings(stranger, input, 'denied')).rejects.toMatchObject({
    code: 'ai_admin_denied',
  });
  const saved = await service.saveOllamaSettings(admin, input, 'save-options');
  expect(saved).toMatchObject({
    thinking: 'xhigh',
    contextTokens: 120000,
    revision: initial.revision + 1,
  });
  await expect(service.saveOllamaSettings(admin, input, 'stale')).rejects.toMatchObject({
    code: 'ai_ollama_config_changed',
  });
  await expect(
    service.saveOllamaSettings(admin, { ...saved, contextTokens: 0 }, 'invalid'),
  ).rejects.toMatchObject({ code: 'ai_ollama_config_invalid' });
  expect((await pool.query('SELECT * FROM ai_ollama_runtime_v2()')).rows[0]).toMatchObject({
    thinking: 'xhigh',
    context_tokens: 120000,
  });
  await expect(pool.query('SELECT * FROM ai_ollama_settings')).rejects.toMatchObject({
    code: '42501',
  });
});
