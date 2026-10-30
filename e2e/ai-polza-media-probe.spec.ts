import { randomUUID, createCipheriv, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { inspectPolzaAudioSeconds } from '../apps/api/src/ai-polza-audio';
import { AiPolzaService } from '../apps/api/src/ai-polza.service';

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

test('real microphone MediaRecorder bytes pass ffprobe and reach only mocked Polza', async ({
  page,
}) => {
  await page.goto('/');
  const audioBase64 = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      recorder.stop();
      await stopped;
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  });
  const bytes = Buffer.from(audioBase64, 'base64');
  expect(bytes.length).toBeGreaterThan(100);
  const measured = await inspectPolzaAudioSeconds(bytes);
  expect(measured).toBeGreaterThan(0.5);
  expect(measured).toBeLessThan(20);

  const encryptionKey = '22'.repeat(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update('test-key-no-network', 'utf8'), cipher.final()]);
  let admissions = 0;
  const pool = {
    query: async (sql: string) => {
      if (sql.includes('ai_polza_runtime'))
        return {
          rows: [
            {
              value: {
                enabled: true,
                transcription_enabled: true,
                daily_seconds_limit: 600,
                global_daily_seconds_limit: 7200,
                max_audio_seconds: 20,
                api_key_ciphertext: ciphertext.toString('base64url'),
                api_key_iv: iv.toString('base64url'),
                api_key_auth_tag: cipher.getAuthTag().toString('base64url'),
                revision: 1,
              },
            },
          ],
        };
      if (sql.includes('ai_polza_stt_admit')) {
        admissions++;
        return { rows: [{ value: 20 }] };
      }
      throw new Error('Unexpected SQL');
    },
  } as unknown as pg.Pool;
  let providerCalls = 0;
  const service = new AiPolzaService(pool, {
    encryptionKey,
    fetchImpl: async (_url, init) => {
      providerCalls++;
      const body = init?.body as FormData;
      expect(body.get('model')).toBe('ai-sage/gigaam-v3');
      expect(body.get('language')).toBe('ru');
      const file = body.get('file') as File;
      expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
      return new Response(JSON.stringify({ text: 'Тестовая расшифровка' }), { status: 200 });
    },
  });
  const result = await service.transcribe(randomUUID(), {
    requestId: randomUUID(),
    audioBase64,
    mimeType: 'audio/webm',
    durationSeconds: measured,
  });
  expect(result.text).toBe('Тестовая расшифровка');
  expect(admissions).toBe(1);
  expect(providerCalls).toBe(1);
});
