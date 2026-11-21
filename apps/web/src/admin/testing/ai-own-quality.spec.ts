// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AiOwnQualityOperation } from '@asa-lab/contracts';
import { AdminAiOwnQuality, ownQualityGrant, ownQualityOperation } from '../AdminAiOwnQuality';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
const URL = '/api/admin/v1/ai/own-quality';
const grant = (enabled = true, revision = 1) => ({
  schemaVersion: 1 as const,
  scope: 'own_personal' as const,
  enabled,
  revision,
  maskingPolicy: 'quality-mask-v1' as const,
});
const row: AiOwnQualityOperation = {
  requestId: '11111111-1111-4111-8111-111111111111',
  admittedAt: '2020-01-01T00:00:00Z',
  timeZone: 'UTC',
  operation: 'chat',
  provider: 'ollama',
  requestedModel: 'qwen3',
  actualModel: null,
  status: 'succeeded',
  answerState: 'complete',
  question: 'Контрольный вопрос',
  answer: 'Контрольный ответ',
  inputTokens: null,
  outputTokens: null,
  policyVersion: null,
  promptVersion: null,
  searchUsed: null,
  toolUsed: null,
  masked: false,
  truncated: false,
};
const page = (items: AiOwnQualityOperation[] = []) => ({
  schemaVersion: 1,
  scope: 'own_personal',
  limit: 10,
  maskingPolicy: 'quality-mask-v1',
  items,
});
const ok = (data: unknown) => ({ ok: true as const, status: 200, data });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(call).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(key = 'a') {
  await act(async () => root.render(createElement(AdminAiOwnQuality, { key })));
}
async function click(label: string) {
  await act(async () => {
    const b = [...host.querySelectorAll('button')].find((e) =>
      (e.getAttribute('aria-label') ?? e.textContent)?.includes(label),
    );
    expect(b).toBeTruthy();
    b!.click();
  });
}
it('keeps content closed without an explicit grant and sends a versioned own-only opt-in', async () => {
  let enabled = false;
  vi.mocked(call).mockImplementation(async (url, options) => {
    if (options?.method === 'PUT') {
      enabled = true;
      return ok(grant(true, 2)) as never;
    }
    return ok(url === URL + '/grant' ? grant(enabled, enabled ? 2 : 1) : page()) as never;
  });
  await render();
  expect(call).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Чужие и школьные диалоги недоступны');
  await click('Разрешить просмотр');
  const write = vi.mocked(call).mock.calls.find(([, options]) => options?.method === 'PUT');
  expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({
    enabled: true,
    expectedRevision: 1,
    requestId: expect.any(String),
  });
  expect(host.textContent).toContain('Доступных операций нет');
});
it('shows exact metadata and escaped content on explicit expansion without rendering raw images or HTML', async () => {
  const full = {
    ...row,
    answer:
      '<img src="https://unsafe.test/x" onerror="alert(1)">\n![external](https://unsafe.test/x)\n```js\nconst x=1;\n```',
  };
  vi.mocked(call).mockImplementation(
    async (url) => ok(url === URL + '/grant' ? grant() : url === URL ? page([row]) : full) as never,
  );
  await render();
  expect(call).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('Фактическая модель неизвестна');
  await click('Контрольный вопрос');
  expect(host.textContent).toContain('Не зафиксирована');
  expect(host.textContent).toContain('Неизвестно / Неизвестно');
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('[onerror]')).toBeNull();
  expect(host.textContent).toContain('const x=1');
});
it('clears all content on revoke and ignores a late detail response', async () => {
  let resolve: ((v: unknown) => void) | undefined,
    enabled = true;
  vi.mocked(call).mockImplementation(async (url, options) => {
    if (options?.method === 'PUT') {
      enabled = false;
      return ok(grant(false, 2)) as never;
    }
    if (url === URL + '/grant') return ok(grant(enabled, enabled ? 1 : 2)) as never;
    if (url === URL) return ok(page([row])) as never;
    return new Promise((r) => {
      resolve = r as (v: unknown) => void;
    }) as never;
  });
  await render();
  await click('Контрольный вопрос');
  await click('Отозвать разрешение');
  await act(async () => resolve?.(ok({ ...row, answer: 'LATE PRIVATE ANSWER' })));
  expect(host.textContent).not.toContain('LATE PRIVATE');
  expect(host.textContent).not.toContain('Контрольный вопрос');
});
it('does not populate a different signed-in actor from a late list result', async () => {
  let resolve: ((v: unknown) => void) | undefined,
    second = false;
  vi.mocked(call).mockImplementation(async (url) => {
    if (url === URL + '/grant') return ok(grant(!second)) as never;
    return new Promise((r) => {
      resolve = r as (v: unknown) => void;
    }) as never;
  });
  await render('actor-a');
  second = true;
  await render('actor-b');
  await act(async () => resolve?.(ok(page([row]))));
  expect(host.textContent).not.toContain('Контрольный вопрос');
});
it('clears content on a revoked-grant detail response and rejects invalid DTOs', async () => {
  vi.mocked(call).mockImplementation(async (url) =>
    url === URL + '/grant'
      ? (ok(grant()) as never)
      : url === URL
        ? (ok(page([row])) as never)
        : ({ ok: false, status: 403, error: { code: 'denied', message: 'denied' } } as never),
  );
  await render();
  await click('Контрольный вопрос');
  expect(host.textContent).not.toContain('Контрольный вопрос');
  expect(host.textContent).toContain('Разрешение отозвано');
  expect(ownQualityGrant({ ...grant(), scope: 'school' })).toBe(false);
  expect(ownQualityOperation({ ...row, status: 'toString' })).toBe(false);
});
