// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminAiGenerationPolicy } from '../AdminAiGenerationPolicy';
import { call } from '../admin-api';
import { generationPolicyFixture } from './ai-generation-policy.fixture';

vi.mock('../admin-api', () => ({ call: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
const denied = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.mocked(call).mockReset();
  denied.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(section: 'prompt' | 'settings' = 'prompt') {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: generationPolicyFixture() });
  await act(async () =>
    root.render(createElement(AdminAiGenerationPolicy, { section, onAccessDenied: denied })),
  );
}
async function text(value: string) {
  const field = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
function writes() {
  return vi
    .mocked(call)
    .mock.calls.filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init?.body)));
}

it('inserts a variable at the cursor and preserves the hidden model policy when saving prompt', async () => {
  await render();
  await text('Привет, !');
  host.querySelector('textarea')!.setSelectionRange(8, 8);
  const insert = host.querySelector<HTMLButtonElement>('[aria-label="Вставить Имя пользователя"]')!;
  await act(async () => insert.click());
  expect(host.querySelector('textarea')!.value).toBe('Привет, {{display_name}}!');
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: generationPolicyFixture({ configurationVersion: 4 }),
  });
  await submit();
  expect(writes()[0]).toMatchObject({
    systemPrompt: 'Привет, {{display_name}}!',
    defaultModel: 'deepseek-flash',
    allowedModels: ['deepseek-flash'],
    configurationVersion: 3,
  });
  expect(writes()[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(host.textContent).toContain('Запрос к модели не выполнялся');
});

it('retains the same request ID across uncertain saves and changes it only for a changed payload', async () => {
  await render();
  vi.mocked(call).mockResolvedValue({
    ok: false,
    status: 0,
    error: { code: 'network', message: 'private details' },
  });
  await submit();
  await submit();
  expect(writes()[0].requestId).toBe(writes()[1].requestId);
  await text('Отвечай кратко и давай полный код.');
  await submit();
  expect(writes()[2].requestId).not.toBe(writes()[0].requestId);
  expect(host.textContent).not.toContain('private details');
});

it('preserves draft across the two policy tabs and disables a default removed from allowed models', async () => {
  await render();
  await text('Краткий новый промпт.');
  await act(async () =>
    root.render(
      createElement(AdminAiGenerationPolicy, { section: 'settings', onAccessDenied: denied }),
    ),
  );
  expect(vi.mocked(call)).toHaveBeenCalledTimes(1);
  const labels = [...host.querySelectorAll('label.asa-ai-policy-model')];
  const deepseek = labels
    .find((label) => label.textContent?.includes('DeepSeek Flash'))!
    .querySelector('input')!;
  await act(async () => deepseek.click());
  expect(host.querySelector('select')!.value).toBe('');
  const openai = labels
    .find((label) => label.textContent?.includes('GPT-6 Luna'))!
    .querySelector('input')!;
  await act(async () => openai.click());
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  await act(async () => {
    const field = host.querySelector('select')!;
    field.value = 'gpt-6-luna';
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: generationPolicyFixture({
      configurationVersion: 4,
      defaultModel: 'gpt-6-luna',
      allowedModels: ['gpt-6-luna'],
    }),
  });
  await submit();
  expect(writes()[0]).toMatchObject({
    systemPrompt: 'Краткий новый промпт.',
    allowedModels: ['gpt-6-luna'],
    defaultModel: 'gpt-6-luna',
  });
});

it('blocks unknown variables before a mutation', async () => {
  await render();
  await text('Покажи {{private_crm_data}}.');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  await submit();
  expect(writes()).toHaveLength(0);
  expect(host.textContent).toContain('Неизвестные переменные: private_crm_data');
});

it('keeps the edited prompt on a revision conflict and requires an explicit reload', async () => {
  await render();
  await text('Мой несохранённый промпт.');
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 409,
    error: { code: 'conflict', message: 'private' },
  });
  await submit();
  expect(host.querySelector('textarea')!.value).toBe('Мой несохранённый промпт.');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: generationPolicyFixture({
      configurationVersion: 9,
      systemPrompt: 'Новая версия коллеги.',
    }),
  });
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent === 'Загрузить актуальные настройки')!
      .click(),
  );
  expect(host.querySelector('textarea')!.value).toBe('Новая версия коллеги.');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
});

it.each([403, 404])('does not expose a policy form for unavailable API %s', async (status) => {
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status,
    error: { code: 'denied', message: 'private' },
  });
  await act(async () =>
    root.render(
      createElement(AdminAiGenerationPolicy, { section: 'prompt', onAccessDenied: denied }),
    ),
  );
  expect(host.querySelector('form')).toBeNull();
  if (status === 403) expect(denied).toHaveBeenCalledOnce();
  else expect(host.textContent).toContain('требуется обновление API');
});
