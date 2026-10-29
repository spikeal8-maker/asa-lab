import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiPolzaError, AiPolzaService, POLZA_STT_MODEL } from './ai-polza.service.js';

const encryptionKey = '22'.repeat(32);
const actor = randomUUID();
const sampleAudio = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from('123456789abcdefg'),
]).toString('base64');

function runtime(key = 'pza_example_for_testing_only') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return {
    enabled: true,
    transcription_enabled: true,
    daily_seconds_limit: 600,
    global_daily_seconds_limit: 7200,
    max_audio_seconds: 20,
    api_key_ciphertext: ciphertext.toString('base64url'),
    api_key_iv: iv.toString('base64url'),
    api_key_auth_tag: cipher.getAuthTag().toString('base64url'),
    revision: 1,
  };
}

function fakePool(run: (sql: string, values: unknown[]) => unknown) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const value = await run(sql, values);
    return { rows: Array.isArray(value) ? value : [{ value }] };
  });
  return { pool: { query } as unknown as pg.Pool, query };
}

describe('Polza encrypted connection and no-paid-check', () => {
  it('encrypts a key before SQL and does not return it in admin JSON', async () => {
    let persisted: Record<string, unknown> | null = null;
    const config = {
      configurationVersion: 2,
      enabled: false,
      transcriptionEnabled: false,
      dailySecondsLimit: 600,
      globalDailySecondsLimit: 7200,
      maxAudioSeconds: 20,
      apiKeyConfigured: true,
      keyFingerprint: 'abcdef012345',
      updatedAt: '2026-10-29T00:00:00Z',
    };
    const { pool } = fakePool((sql, values) => {
      if (sql.includes('admin_set')) {
        persisted = JSON.parse(values[1] as string) as Record<string, unknown>;
        return config;
      }
      if (sql.includes('admin_config')) return config;
      throw new Error('Unexpected SQL: ' + sql);
    });
    const service = new AiPolzaService(pool, { encryptionKey });
    const result = await service.save(actor, {
      configurationVersion: 1,
      enabled: false,
      transcriptionEnabled: false,
      dailySecondsLimit: 600,
      globalDailySecondsLimit: 7200,
      maxAudioSeconds: 20,
      apiKey: 'pza_credential_for_test_only',
    });
    expect(persisted?.['action']).toBe('replace');
    expect(JSON.stringify(persisted)).not.toContain('pza_credential_for_test_only');
    expect(result.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain('pza_credential_for_test_only');
  });

  it('uses the no-charge model listing endpoint for a connection check', async () => {
    const source = runtime();
    const { pool } = fakePool((sql) => {
      if (sql.includes('admin_config'))
        return {
          configurationVersion: 1,
          enabled: true,
          transcriptionEnabled: true,
          dailySecondsLimit: 600,
          globalDailySecondsLimit: 7200,
          maxAudioSeconds: 20,
          apiKeyConfigured: true,
          keyFingerprint: 'abc',
          updatedAt: '2026-10-29T00:00:00Z',
        };
      if (sql.includes('ai_polza_runtime')) return [source];
      throw new Error('Unexpected SQL: ' + sql);
    });
    const provider = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
    });
    const result = await service.check(actor);
    expect(result.ready).toBe(true);
    expect(provider).toHaveBeenCalledOnce();
    expect(provider.mock.calls[0]?.[0]).toBe('https://polza.ai/api/v1/models');
    expect(provider.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });
});

describe('STT admission and request isolation', () => {
  it('reserves quota before one paid transcription, with a fixed Russian model', async () => {
    const source = runtime();
    const actions: string[] = [];
    const { pool } = fakePool((sql) => {
      if (sql.includes('ai_polza_runtime')) return [source];
      if (sql.includes('ai_polza_stt_admit')) {
        actions.push('admitted');
        return 20;
      }
      throw new Error('Unexpected SQL');
    });
    const provider = vi.fn(async (_url: string, init: RequestInit) => {
      actions.push('sent');
      const body = init.body as FormData;
      expect(body.get('model')).toBe(POLZA_STT_MODEL);
      expect(body.get('language')).toBe('ru');
      expect(body.get('file')).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ text: 'Привет, ASA Lab.' }), { status: 200 });
    });
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as unknown as typeof fetch,
      inspectDuration: async () => 8,
    });
    const result = await service.transcribe(actor, {
      requestId: randomUUID(),
      audioBase64: sampleAudio,
      mimeType: 'audio/webm',
      durationSeconds: 8,
    });
    expect(result.text).toBe('Привет, ASA Lab.');
    expect(actions).toEqual(['admitted', 'sent']);
  });

  it('rejects forged container bytes before dispatch and does not consume the budget', async () => {
    const { pool, query } = fakePool((sql) => {
      if (sql.includes('ai_polza_runtime')) return [runtime()];
      throw new Error('No admission expected');
    });
    const provider = vi.fn();
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
    });
    await expect(
      service.transcribe(actor, {
        requestId: randomUUID(),
        audioBase64: Buffer.from('not-a-webm-container-file').toString('base64'),
        mimeType: 'audio/webm',
        durationSeconds: 5,
      }),
    ).rejects.toMatchObject({ code: 'ai_stt_input_invalid' } satisfies Partial<AiPolzaError>);
    expect(provider).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects a forged short-duration claim before quota or network dispatch', async () => {
    const source = runtime();
    const { pool, query } = fakePool((sql) => {
      if (sql.includes('ai_polza_runtime')) return [source];
      throw new Error('Budget must not be consumed');
    });
    const provider = vi.fn();
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
      inspectDuration: async () => 42,
    });
    await expect(
      service.transcribe(actor, {
        requestId: randomUUID(),
        audioBase64: sampleAudio,
        mimeType: 'audio/webm',
        durationSeconds: 2,
      }),
    ).rejects.toMatchObject({ code: 'ai_stt_duration_invalid', status: 400 });
    expect(provider).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('blocks replay after an uncertain request without contacting Polza again', async () => {
    const { pool } = fakePool((sql) => {
      if (sql.includes('ai_polza_runtime')) return [runtime()];
      throw new Error('AI_STT_REPLAY_BLOCKED');
    });
    const provider = vi.fn();
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
      inspectDuration: async () => 10,
    });
    await expect(
      service.transcribe(actor, {
        requestId: randomUUID(),
        audioBase64: sampleAudio,
        mimeType: 'audio/webm',
        durationSeconds: 10,
      }),
    ).rejects.toMatchObject({ code: 'ai_stt_request_reused', status: 409 });
    expect(provider).not.toHaveBeenCalled();
  });
  it('never exceeds two active requests during a queued handoff', async () => {
    const { pool } = fakePool((sql) => {
      if (sql.includes('ai_polza_runtime')) return [runtime()];
      if (sql.includes('ai_polza_stt_admit')) return 20;
      throw new Error('Unexpected SQL');
    });
    let active = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    const provider = vi.fn(async () => {
      active += 1;
      peak = Math.max(active, peak);
      await new Promise<void>((resolve) => pending.push(resolve));
      active -= 1;
      return new Response(JSON.stringify({ text: 'Готово' }), { status: 200 });
    });
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
      inspectDuration: async () => 5,
    });
    const tasks = [0, 1, 2].map(() =>
      service.transcribe(randomUUID(), {
        requestId: randomUUID(),
        audioBase64: sampleAudio,
        mimeType: 'audio/webm',
        durationSeconds: 5,
      }),
    );
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
    expect(peak).toBe(2);
    pending.shift()?.();
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(3));
    expect(peak).toBe(2);
    pending.shift()?.();
    pending.shift()?.();
    await expect(Promise.all(tasks)).resolves.toHaveLength(3);
    expect(active).toBe(0);
  });

  it('accepts a thirty-learner burst as two active requests and a bounded cancellable queue', async () => {
    const admitted: string[] = [];
    const { pool } = fakePool((sql, params) => {
      if (sql.includes('ai_polza_runtime')) return [runtime()];
      if (sql.includes('ai_polza_stt_admit')) {
        admitted.push(String(params[0]));
        return 20;
      }
      throw new Error('Unexpected SQL');
    });
    const gates: Array<() => void> = [];
    const provider = vi.fn(async () => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return new Response(JSON.stringify({ text: 'Готово' }), { status: 200 });
    });
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
      inspectDuration: async () => 5,
    });
    const makeInput = () => ({
      requestId: randomUUID(),
      audioBase64: sampleAudio,
      mimeType: 'audio/webm',
      durationSeconds: 5,
    });
    const first = service.transcribe(randomUUID(), makeInput());
    const second = service.transcribe(randomUUID(), makeInput());
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
    const cancels = Array.from({ length: 28 }, () => new AbortController());
    const queued = cancels.map((controller) =>
      service.transcribe(randomUUID(), makeInput(), controller.signal),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    cancels.forEach((controller) => controller.abort());
    const results = await Promise.allSettled(queued);
    expect(results).toHaveLength(28);
    expect(
      results.every(
        (result) => result.status === 'rejected' && result.reason.code === 'ai_stt_cancelled',
      ),
    ).toBe(true);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(admitted).toHaveLength(2);
    gates.splice(0).forEach((release) => release());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it('cancels queued work before SQL admission or a paid provider request', async () => {
    const admitted: string[] = [];
    const { pool } = fakePool((sql, params) => {
      if (sql.includes('ai_polza_runtime')) return [runtime()];
      if (sql.includes('ai_polza_stt_admit')) {
        admitted.push(String(params[0]));
        return 20;
      }
      throw new Error('Unexpected SQL');
    });
    const pending: Array<() => void> = [];
    const provider = vi.fn(async () => {
      await new Promise<void>((resolve) => pending.push(resolve));
      return new Response(JSON.stringify({ text: 'Готово' }), { status: 200 });
    });
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
      inspectDuration: async () => 5,
    });
    const makeInput = () => ({
      requestId: randomUUID(),
      audioBase64: sampleAudio,
      mimeType: 'audio/webm',
      durationSeconds: 5,
    });
    const first = service.transcribe(randomUUID(), makeInput());
    const second = service.transcribe(randomUUID(), makeInput());
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
    const abort = new AbortController();
    const third = service.transcribe(randomUUID(), makeInput(), abort.signal);
    const assertion = expect(third).rejects.toMatchObject({ code: 'ai_stt_cancelled' });
    await vi.waitFor(() => expect(admitted).toHaveLength(2));
    abort.abort();
    await assertion;
    expect(provider).toHaveBeenCalledTimes(2);
    pending.shift()?.();
    pending.shift()?.();
    await Promise.all([first, second]);
    expect(admitted).toHaveLength(2);
  });

  it('keeps a restored but undecryptable key disabled and consumes no speech allowance', async () => {
    const broken = { ...runtime(), api_key_auth_tag: 'invalid-authentication-tag' };
    const { pool, query } = fakePool((sql) => {
      if (sql.includes('ai_polza_runtime')) return [broken];
      throw new Error('Invalid keys must not reach paid admission');
    });
    const provider = vi.fn();
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
      inspectDuration: async () => 5,
    });
    expect((await service.status()).enabled).toBe(false);
    await expect(
      service.transcribe(actor, {
        requestId: randomUUID(),
        audioBase64: sampleAudio,
        mimeType: 'audio/webm',
        durationSeconds: 5,
      }),
    ).rejects.toMatchObject({ code: 'ai_polza_key_invalid', status: 503 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(provider).not.toHaveBeenCalled();
  });

  it('denies a revoked School Seat before spending quota or dispatching speech', async () => {
    const { pool, query } = fakePool((sql) => {
      if (sql.includes('ai_polza_runtime')) return [runtime()];
      throw new Error('Denied requests must not reach quota admission');
    });
    const provider = vi.fn();
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
      inspectDuration: async () => 5,
    });
    await expect(
      service.transcribe(
        actor,
        {
          requestId: randomUUID(),
          audioBase64: sampleAudio,
          mimeType: 'audio/webm',
          durationSeconds: 5,
        },
        undefined,
        async () => {
          throw new AiPolzaError('ai_stt_denied', 403, 'School access revoked.');
        },
      ),
    ).rejects.toMatchObject({ code: 'ai_stt_denied', status: 403 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects oversized chunked upstream replies without buffering or parsing their JSON', async () => {
    const { pool } = fakePool((sql) => {
      if (sql.includes('ai_polza_runtime')) return [runtime()];
      if (sql.includes('ai_polza_stt_admit')) return 20;
      throw new Error('Unexpected SQL');
    });
    const provider = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: 'А'.repeat(15_000) }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        }),
    );
    const service = new AiPolzaService(pool, {
      encryptionKey,
      fetchImpl: provider as typeof fetch,
      inspectDuration: async () => 5,
    });
    await expect(
      service.transcribe(actor, {
        requestId: randomUUID(),
        audioBase64: sampleAudio,
        mimeType: 'audio/webm',
        durationSeconds: 5,
      }),
    ).rejects.toMatchObject({
      code: 'ai_stt_response_invalid',
      status: 502,
      message: 'Ответ распознавания превышает лимит.',
    });
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
