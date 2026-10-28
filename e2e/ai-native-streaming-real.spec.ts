import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { e2eAdminPool } from './seed';

const ORIGIN = 'http://127.0.0.1:4612';
const BASELINE = process.env.ASAI_STREAM_EXPECT_BUFFERED === 'true';
const PIECES = ['Первый фрагмент. ', 'Второй фрагмент. ', 'Третий фрагмент.'];
const TOOL_PREFIX = 'Перед поиском: ';
const INTERNAL_REASONING = 'INTERNAL_REASONING_7F2';
const INTERNAL_ARGUMENT = 'ARG_ONLY_7F2';
type Mode = 'off' | 'unused' | 'called' | 'stop';
type Mark = { stage: string; atMs: number; mode: Mode };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function frame(reply: ServerResponse, value: unknown) {
  reply.write(JSON.stringify(value) + '\n');
}

test('built AI chat streams real API deltas before upstream done with offered tools', async ({
  page,
}) => {
  const started = Date.now();
  const marks: Mark[] = [];
  const mark = (mode: Mode, stage: string) =>
    marks.push({ mode, stage, atMs: Date.now() - started });
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const db = e2eAdminPool();
  const original = await db.query<{ enabled: boolean; base_url: string; model: string }>(
    'SELECT enabled,base_url,model FROM ai_ollama_settings WHERE singleton_key',
  );
  const webOriginal = await db.query<{ enabled: boolean }>(
    'SELECT enabled FROM ai_web_search_settings WHERE singleton_key',
  );
  let active: {
    mode: Mode;
    first: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
    calls: number;
    toolOffered: boolean;
    closed: number;
  } | null = null;
  const upstream = createServer(async (request, reply) => {
    if (request.url === '/api/show') {
      reply.writeHead(200, { 'content-type': 'application/json' });
      reply.end(JSON.stringify({ capabilities: ['completion', 'tools'] }));
      return;
    }
    if (request.url === '/api/tags') {
      reply.writeHead(200, { 'content-type': 'application/json' });
      reply.end(JSON.stringify({ models: [{ name: 'fixture:stream', size: 1 }] }));
      return;
    }
    if (request.url?.startsWith('/search?')) {
      mark(active?.mode ?? 'called', 'search-request');
      reply.writeHead(200, { 'content-type': 'application/json' });
      reply.end(
        JSON.stringify({
          results: [
            {
              url: 'https://example.org/lesson',
              title: 'Учебный источник',
              content: 'Общедоступный пример.',
            },
          ],
        }),
      );
      return;
    }
    if (request.url !== '/api/chat' || !active) {
      reply.writeHead(404).end();
      return;
    }
    const script = active;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      tools?: unknown[];
      messages?: unknown[];
    };
    script.calls++;
    script.toolOffered ||= Array.isArray(input.tools) && input.tools.length > 0;
    reply.on('close', () => {
      script.closed++;
      mark(script.mode, 'upstream-close');
    });
    reply.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
    if (script.mode === 'called' && script.calls === 1) {
      frame(reply, {
        message: {
          role: 'assistant',
          content: TOOL_PREFIX,
          thinking: INTERNAL_REASONING,
          tool_calls: [
            {
              type: 'function',
              function: {
                name: 'web_search',
                arguments: { query: 'учебный пример ' + INTERNAL_ARGUMENT },
              },
            },
          ],
        },
        done: false,
      });
      frame(reply, { done: true });
      mark(script.mode, 'tool-call');
      reply.end();
      return;
    }
    frame(reply, { message: { role: 'assistant', content: PIECES[0] }, done: false });
    mark(script.mode, 'provider-first');
    script.first.resolve();
    await script.release.promise;
    if (reply.destroyed || reply.writableEnded) return;
    frame(reply, { message: { role: 'assistant', content: PIECES[1] }, done: false });
    frame(reply, { message: { role: 'assistant', content: PIECES[2] }, done: false });
    frame(reply, { done: true, prompt_eval_count: 12, eval_count: 8 });
    mark(script.mode, 'provider-done');
    reply.end();
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(19422, '127.0.0.1', resolve);
  });
  try {
    await page.goto('/#/explore');
    const id = randomUUID().replaceAll('-', '');
    const registration = await page.request.post('/api/auth/register', {
      headers: { origin: ORIGIN },
      data: {
        email: `ai-stream-${id}@isolated.test`,
        username: `as_${id.slice(0, 25)}`,
        displayName: 'Проверка потока',
        password: `Stream-${id}-Password`,
        birthDate: '1990-01-01',
        country: 'RU',
      },
    });
    expect(registration.status()).toBe(201);
    const account = (await registration.json()) as { user: { id: string } };
    await db.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
      account.user.id,
    ]);
    await db.query(
      "UPDATE ai_ollama_settings SET enabled=true,base_url='http://127.0.0.1:19422',model='fixture:stream',revision=revision+1 WHERE singleton_key",
    );
    await db.query(
      'UPDATE ai_web_search_settings SET enabled=true,revision=revision+1 WHERE singleton_key',
    );
    const identity = await page.request.get('/api/auth/me');
    expect(identity.status()).toBe(200);
    const session = (await identity.json()) as {
      authenticated: boolean;
      verification?: { required: boolean };
    };
    expect(session.authenticated).toBe(true);
    expect(session.verification?.required).toBe(false);
    expect(process.env.ASA_BUILD_REVISION).toBe(revision);
    expect(process.env.VITE_ASA_BUILD_REVISION).toBe(revision);
    expect((await (await page.request.get('/api/version')).json()).revision).toBe(revision);
    expect((await (await page.request.get('/build-metadata.json')).json()).revision).toBe(revision);
    await page.goto('/#/ai');
    // Registration used the shared APIRequestContext after the SPA had already
    // observed an anonymous session. Reload rehydrates App from the real cookie.
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toBeVisible();
    const status = (await (await page.request.get('/api/ai/status')).json()) as {
      enabled: boolean;
      model: string;
    };
    expect(status.enabled).toBe(true);
    expect(status.model).toBe('ollama-local');

    for (const mode of (BASELINE ? ['unused'] : ['off', 'unused', 'called', 'stop']) as Mode[]) {
      active = {
        mode,
        first: deferred(),
        release: deferred(),
        calls: 0,
        toolOffered: false,
        closed: 0,
      };
      await page.getByRole('button', { name: 'Создать новый диалог' }).click();
      await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toBeEnabled();
      await page.locator('details.chat-tools-menu summary').click();
      const search = page.getByRole('combobox', { name: 'Режим интернет-поиска' });
      await search.selectOption(mode === 'off' ? 'off' : 'auto');
      await page
        .getByRole('textbox', { name: 'Сообщение ИИ' })
        .fill('Объясни коротко учебный пример.');
      await page.getByRole('button', { name: 'Отправить сообщение' }).click();
      await active.first.promise;
      expect(active.toolOffered).toBe(mode !== 'off');
      const partial = page.getByTestId('ai-streaming-answer');
      if (BASELINE) {
        await expect(partial).toHaveCount(0);
        mark(mode, 'browser-buffered-before-provider-done');
      } else {
        await expect(partial).toContainText(PIECES[0]);
        if (mode === 'called') await expect(partial).toContainText(TOOL_PREFIX);
        mark(mode, 'browser-first-before-provider-done');
      }
      if (mode === 'called') {
        await expect(page.locator('.chat-turn-assistant').last()).not.toContainText(
          INTERNAL_REASONING,
        );
        await expect(page.locator('.chat-turn-assistant').last()).not.toContainText(
          INTERNAL_ARGUMENT,
        );
      }
      expect(marks.some((item) => item.mode === mode && item.stage === 'provider-done')).toBe(
        false,
      );
      if (mode === 'unused') {
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
          for (const theme of ['light', 'dark'] as const) {
            const toggle = page.getByRole('button', {
              name: theme === 'light' ? 'Светлая тема чата' : 'Тёмная тема чата',
            });
            if (await toggle.count()) await toggle.click();
            await page.screenshot({
              path: test
                .info()
                .outputPath(`${BASELINE ? 'before' : 'after'}-held-${width}-${theme}.png`),
              fullPage: true,
            });
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            ).toBe(true);
          }
        }
      }
      if (mode === 'stop' && !BASELINE) {
        await page.getByRole('button', { name: 'Остановить генерацию' }).click();
        mark(mode, 'stop-click');
        await expect(page.locator('.chat-turn-assistant').last().getByRole('status')).toContainText(
          'Ответ не завершён',
        );
        const composer = page.getByRole('textbox', { name: 'Сообщение ИИ' });
        await expect(composer).toBeEnabled();
        await composer.fill('Следующий учебный вопрос');
        await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeEnabled();
        active.release.resolve();
      } else {
        active.release.resolve();
      }
      const expectedAnswer =
        mode === 'stop'
          ? PIECES[0].trim()
          : (mode === 'called' ? TOOL_PREFIX : '') + PIECES.join('');
      const answer = page.locator('.chat-turn-assistant').last().locator('.asa-ai-rich-text');
      await expect(answer).toHaveText(expectedAnswer.trim());
      expect(active.calls).toBe(mode === 'called' ? 2 : 1);
      if (mode === 'called')
        expect(marks.some((item) => item.mode === mode && item.stage === 'search-request')).toBe(
          true,
        );
      const count = active.calls;
      await page.reload();
      await expect(
        page.locator('.chat-turn-assistant').last().locator('.asa-ai-rich-text'),
      ).toHaveText(expectedAnswer.trim());
      if (mode === 'stop')
        await expect(page.locator('.chat-turn-assistant').last().getByRole('status')).toContainText(
          'Ответ не завершён',
        );
      if (mode === 'called') {
        await expect(page.locator('.chat-turn-assistant').last()).not.toContainText(
          INTERNAL_REASONING,
        );
        await expect(page.locator('.chat-turn-assistant').last()).not.toContainText(
          INTERNAL_ARGUMENT,
        );
      }
      expect(active.calls).toBe(count);
    }
  } finally {
    writeFileSync(
      test.info().outputPath('safe-event-sequence.json'),
      JSON.stringify({ sourceRevision: revision, baseline: BASELINE, events: marks }, null, 2),
    );
    active?.release.resolve();
    await db.query(
      'UPDATE ai_ollama_settings SET enabled=$1,base_url=$2,model=$3,revision=revision+1 WHERE singleton_key',
      [original.rows[0]!.enabled, original.rows[0]!.base_url, original.rows[0]!.model],
    );
    await db.query(
      'UPDATE ai_web_search_settings SET enabled=$1,revision=revision+1 WHERE singleton_key',
      [webOriginal.rows[0]!.enabled],
    );
    await db.end();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
