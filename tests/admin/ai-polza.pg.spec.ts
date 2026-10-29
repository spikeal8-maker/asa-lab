import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AiPolzaService, POLZA_STT_MODEL } from '../../apps/api/src/ai-polza.service';
import { aiIdentity, type AiIdentity } from './ai-student-access.contract';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import { testAdminPool, testAppPool } from '../portal/helpers';

const SECRET = '39'.repeat(32);
const TEST_API_KEY = 'pza_isolated_pg_test_key_only';
let admin: pg.Pool;
let first: pg.Pool;
let second: pg.Pool;
let releaseLock: (() => Promise<void>) | undefined;
let platform: AiIdentity;
let owner: AiIdentity;
let original: Record<string, unknown>;
let service: AiPolzaService;
const sends = vi.fn<typeof fetch>(async (url, options) => {
  expect(url).toBe('https://polza.ai/api/v1/audio/transcriptions');
  expect(new Headers(options?.headers).get('authorization')).toBe('Bearer ' + TEST_API_KEY);
  expect((options?.body as FormData)?.get('model')).toBe(POLZA_STT_MODEL);
  return new Response(JSON.stringify({ text: 'Готовый русский текст.' }), { status: 200 });
});
const AUDIO = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from('synthetic-audio-pg'),
]).toString('base64');

beforeAll(async () => {
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
    const raw = process.env[key];
    if (!raw || !decodeURIComponent(new URL(raw).pathname).endsWith('_test'))
      throw new Error(key + ' must point to an isolated _test PostgreSQL database');
    return new URL(raw);
  });
  if (urls[0]!.host !== urls[1]!.host || urls[0]!.pathname !== urls[1]!.pathname)
    throw new Error('Admin and runtime must use the same isolated database');
  admin = testAdminPool();
  first = testAppPool();
  second = testAppPool();
  releaseLock = await lockAiPostgresSuite(admin);
  original = (await admin.query('SELECT * FROM public.ai_polza_settings')).rows[0]!;
  platform = await aiIdentity(admin);
  owner = await aiIdentity(admin);
  await admin.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
     VALUES($1,'platform_admin','verified','test','admin')`,
    [platform.account_id],
  );
  service = new AiPolzaService(first, {
    encryptionKey: SECRET,
    inspectDuration: async () => 10,
    fetchImpl: sends,
  });
  const config = await service.admin(platform.principal_id);
  const saved = await service.save(platform.principal_id, {
    configurationVersion: config.configurationVersion,
    enabled: true,
    transcriptionEnabled: true,
    dailySecondsLimit: 3600,
    globalDailySecondsLimit: 600,
    maxAudioSeconds: 30,
    apiKey: TEST_API_KEY,
  });
  expect(saved.apiKeyConfigured).toBe(true);
  expect(JSON.stringify(saved)).not.toContain(TEST_API_KEY);
}, 90000);

afterAll(async () => {
  try {
    if (admin && owner) {
      await admin.query(
        'DELETE FROM public.ai_polza_stt_attempts WHERE owner_principal_id=$1',
        [owner.principal_id],
      );
      await admin.query(
        'DELETE FROM public.ai_polza_daily_usage WHERE owner_principal_id=$1',
        [owner.principal_id],
      );
    }
    if (admin && original) {
      await admin.query(
        `UPDATE public.ai_polza_settings
         SET enabled=$1, transcription_enabled=$2, daily_seconds_limit=$3,
         global_daily_seconds_limit=$4, max_audio_seconds=$5, revision=$6,
         api_key_ciphertext=$7, api_key_iv=$8, api_key_auth_tag=$9,
         key_fingerprint=$10, updated_at=$11 WHERE singleton_key`,
        [
          original['enabled'], original['transcription_enabled'],
          original['daily_seconds_limit'], original['global_daily_seconds_limit'],
          original['max_audio_seconds'], original['revision'],
          original['api_key_ciphertext'], original['api_key_iv'],
          original['api_key_auth_tag'], original['key_fingerprint'], original['updated_at'],
        ],
      );
    }
  } finally {
    await first?.end();
    await second?.end();
    await releaseLock?.();
    await admin?.end();
  }
});

it('isolates the encrypted key and rejects non-admin and direct runtime table reads', async () => {
  await expect(first.query('SELECT * FROM public.ai_polza_settings')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    first.query('SELECT public.ai_polza_admin_config($1::uuid)', [owner.principal_id]),
  ).rejects.toMatchObject({ code: '42501' });
  const current = await service.admin(platform.principal_id);
  expect(current.enabled).toBe(true);
  expect(current.transcriptionEnabled).toBe(true);
  const saved = (await admin.query('SELECT * FROM public.ai_polza_settings')).rows[0]!;
  expect(saved.api_key_ciphertext).not.toContain(TEST_API_KEY);
  expect(saved.api_key_ciphertext).toBeTruthy();
});

it('enforces global speech budget atomically across real PostgreSQL connections', async () => {
  const attempts = await Promise.allSettled(
    Array.from({ length: 22 }, (_, i) =>
      (i % 2 ? first : second).query(
        'SELECT public.ai_polza_stt_admit($1::uuid,$2::uuid)',
        [owner.principal_id, randomUUID()],
      ),
    ),
  );
  const admitted = attempts.filter((item) => item.status === 'fulfilled');
  const denied = attempts.filter((item) => item.status === 'rejected');
  expect(admitted).toHaveLength(20);
  expect(denied).toHaveLength(2);
  expect(denied.every((item) =>
    item.status === 'rejected' && item.reason.message.includes('AI_STT_DAILY_LIMIT'),
  )).toBe(true);
  const usage = await admin.query<{ reserved_seconds: number }>(
    'SELECT reserved_seconds FROM public.ai_polza_daily_usage WHERE owner_principal_id=$1',
    [owner.principal_id],
  );
  expect(usage.rows[0]?.reserved_seconds).toBe(600);
});

it('prevents paid replay and retains one API call on uncertain duplicate UUID', async () => {
  const before = await service.admin(platform.principal_id);
  await service.save(platform.principal_id, {
    configurationVersion: before.configurationVersion,
    enabled: true,
    transcriptionEnabled: true,
    dailySecondsLimit: 3600,
    globalDailySecondsLimit: 1200,
    maxAudioSeconds: 30,
  });
  const requestId = randomUUID();
  const input = {
    requestId,
    audioBase64: AUDIO,
    mimeType: 'audio/webm' as const,
    durationSeconds: 10,
  };
  expect((await service.transcribe(owner.principal_id, input)).text).toContain('русский');
  expect(sends).toHaveBeenCalledTimes(1);
  await expect(service.transcribe(owner.principal_id, input)).rejects.toMatchObject({
    code: 'ai_stt_request_reused',
    status: 409,
  });
  expect(sends).toHaveBeenCalledTimes(1);
});
