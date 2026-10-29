// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminAiGenerationPolicy } from '../AdminAiGenerationPolicy';
import { call } from '../admin-api';
import { generationPolicyFixture } from './ai-generation-policy.fixture';

vi.mock('../admin-api', () => ({ call: vi.fn() }));
vi.mock('../AdminAiToolPolicies', () => ({ AdminAiToolPolicies: () => null }));
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
  expect(vi.mocked(call).mock.calls.filter(([, init]) => !init?.method)).toHaveLength(1);
  expect(vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
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

it('shows only configured providers, reorders tied visible rows and saves checkbox changes without touching hidden policy', async () => {
  const base = generationPolicyFixture();
  const initial = generationPolicyFixture({
    models: [
      ...base.models.map((m) =>
        m.provider === 'openai'
          ? { ...m, ready: false }
          : m.provider === 'ollama-cloud'
            ? { ...m, selectable: false }
            : m,
      ),
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek Pro',
        provider: 'deepseek',
        ready: true,
        selectable: true,
        allowed: false,
      },
    ],
    modelPreferences: [
      { id: 'gpt-6-luna', eligible: true, order: -99 },
      { id: 'toString', eligible: false, order: 123 },
    ],
    providerOrder: { openai: -50, deepseek: 10, 'ollama-cloud': 10, retired: 42 },
  });
  vi.mocked(call).mockImplementation(async (_url, init) => ({
    ok: true,
    status: 200,
    data:
      init?.method === 'PUT'
        ? { ...initial, ...JSON.parse(String(init.body)), configurationVersion: 4 }
        : initial,
  }));
  await act(async () =>
    root.render(
      createElement(AdminAiGenerationPolicy, { section: 'settings', onAccessDenied: denied }),
    ),
  );
  expect(host.querySelector('[aria-label="Показывать пользователям: GPT-6 Luna"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="Показывать пользователям: Gemma 4 31B · Ollama Cloud"]'),
  ).not.toBeNull();
  expect(host.querySelectorAll('input[type=number]')).toHaveLength(0);
  const click = async (label: string) =>
    act(async () => host.querySelector<HTMLButtonElement>('[aria-label="' + label + '"]')!.click());
  await click('Поднять модель DeepSeek Pro');
  await click('Поднять провайдера Ollama Cloud');
  expect(host.querySelector('.asa-ai-policy-models > fieldset legend')?.textContent).toContain(
    'Ollama Cloud',
  );
  await act(async () =>
    host
      .querySelector<HTMLInputElement>('[aria-label="Показывать пользователям: DeepSeek Pro"]')!
      .click(),
  );
  await submit();
  expect(writes()[0]).toMatchObject({
    configurationVersion: 3,
    systemPrompt: initial.systemPrompt,
    defaultModel: 'deepseek-flash',
    allowedModels: ['deepseek-flash', 'deepseek-v4-pro'],
    providerOrder: { openai: -50, deepseek: 1, 'ollama-cloud': 0, retired: 42 },
    modelPreferences: expect.arrayContaining([
      { id: 'gpt-6-luna', eligible: true, order: -99 },
      { id: 'toString', eligible: false, order: 123 },
      { id: 'deepseek-v4-pro', eligible: true, order: 0 },
      { id: 'deepseek-flash', eligible: true, order: 1 },
    ]),
  });
});

it('B preserves unsaved visibility, default and rank during metadata refresh and reports a concurrent policy revision', async () => {
  const observations = (['openai', 'deepseek'] as const).map((provider) => ({
    provider,
    source: 'fixture metadata',
    checkedAt: new Date().toISOString(),
    failed: false,
    models: [],
  }));
  const initial = generationPolicyFixture({ observations });
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: initial });
  await act(async () =>
    root.render(
      createElement(AdminAiGenerationPolicy, { section: 'settings', onAccessDenied: denied }),
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Поднять провайдера OpenAI"]')!.click(),
  );
  const rankedProviders = [...host.querySelectorAll('.asa-ai-policy-models > fieldset legend')].map(
    (node) => node.textContent,
  );
  const labels = [...host.querySelectorAll('label.asa-ai-policy-model')];
  await act(async () =>
    labels
      .find((l) => l.textContent?.includes('GPT-6 Luna'))!
      .querySelector<HTMLInputElement>('input')!
      .click(),
  );
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Модель по умолчанию"]')!;
  await act(async () => {
    select.value = 'gpt-6-luna';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: generationPolicyFixture({ configurationVersion: 4, observations }),
  });
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Обновить каталог OpenAI')!
      .click(),
  );
  expect(
    [...host.querySelectorAll('.asa-ai-policy-models > fieldset legend')].map(
      (node) => node.textContent,
    ),
  ).toEqual(rankedProviders);
  expect(select.value).toBe('gpt-6-luna');
  expect(
    labels
      .find((l) => l.textContent?.includes('GPT-6 Luna'))!
      .querySelector<HTMLInputElement>('input')!.checked,
  ).toBe(true);
  expect(host.textContent).toContain('Настройки изменились во время обновления каталога');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  expect(writes()).toHaveLength(0);
});

it('names provider eligibility and user visibility as separate checkbox actions', async () => {
  await render('settings');
  const eligible = host.querySelector<HTMLInputElement>(
    '[aria-label="Разрешить у провайдера DeepSeek Flash"]',
  );
  const visible = host.querySelector<HTMLInputElement>(
    '[aria-label="Показывать пользователям: DeepSeek Flash"]',
  );
  expect(eligible).toBeNull();
  expect(visible?.type).toBe('checkbox');
  expect(eligible).not.toBe(visible);
});

it('Connections saves provider eligibility with full policy CAS; Settings omits ineligible models and guards its existing default', async () => {
  const initial = generationPolicyFixture({
    modelPreferences: [
      { id: 'gpt-6-luna', eligible: true, order: 12 },
      { id: 'deepseek-flash', eligible: true, order: 3 },
    ],
  });
  let policy = initial;
  vi.mocked(call).mockImplementation(async (_url, init) => {
    if (init?.method === 'PUT') {
      const input = JSON.parse(String(init.body));
      policy = { ...policy, ...input, configurationVersion: 4 };
    }
    return { ok: true, status: 200, data: policy };
  });
  await act(async () =>
    root.render(
      createElement(AdminAiGenerationPolicy, {
        section: 'connections',
        provider: 'openai',
        onAccessDenied: denied,
      }),
    ),
  );
  const eligibility = host.querySelector<HTMLInputElement>(
    '[aria-label="Разрешить у провайдера GPT-6 Luna"]',
  )!;
  expect(host.querySelector('[aria-label="Показывать пользователям: GPT-6 Luna"]')).toBeNull();
  await act(async () => eligibility.click());
  await submit();
  expect(writes()[0]).toMatchObject({
    configurationVersion: 3,
    defaultModel: 'deepseek-flash',
    allowedModels: ['deepseek-flash'],
    systemPrompt: initial.systemPrompt,
    modelPreferences: expect.arrayContaining([{ id: 'gpt-6-luna', eligible: false, order: 12 }]),
  });
  await act(async () =>
    root.render(
      createElement(AdminAiGenerationPolicy, {
        section: 'settings',
        onAccessDenied: denied,
      }),
    ),
  );
  expect(host.querySelector('[aria-label="Порядок модели GPT-6 Luna"]')).toBeNull();
  expect(host.querySelector('[aria-label="Показывать пользователям: GPT-6 Luna"]')).toBeNull();
  expect(
    host.querySelector('[aria-label="Показывать пользователям: DeepSeek Flash"]'),
  ).not.toBeNull();
  await act(async () =>
    root.render(
      createElement(AdminAiGenerationPolicy, {
        section: 'connections',
        provider: 'deepseek',
        onAccessDenied: denied,
      }),
    ),
  );
  expect(
    host.querySelector<HTMLInputElement>('[aria-label="Разрешить у провайдера DeepSeek Flash"]')!
      .disabled,
  ).toBe(true);
  expect(host.textContent).toContain('Сначала выберите другую модель по умолчанию');
});

it('omits models unselected by Cloud keys without losing a hidden stored default or visibility', async () => {
  const base = generationPolicyFixture();
  const policy = generationPolicyFixture({
    defaultModel: 'gemma4:31b',
    allowedModels: ['gemma4:31b'],
    models: base.models.map((m) => ({
      ...m,
      connectionSelected: m.id !== 'gemma4:31b',
      ...(m.id === 'deepseek-flash' ? { ready: true, selectable: false } : {}),
    })),
  });
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: policy });
  await act(async () =>
    root.render(
      createElement(AdminAiGenerationPolicy, { section: 'settings', onAccessDenied: denied }),
    ),
  );
  expect(
    host.querySelector('[aria-label="Показывать пользователям: Gemma 4 31B · Ollama Cloud"]'),
  ).toBeNull();
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Модель по умолчанию"]')!;
  expect(
    host.querySelector('[aria-label="Показывать пользователям: DeepSeek Flash"]'),
  ).not.toBeNull();
  expect(select.value).toBe('gemma4:31b');
  expect(select.selectedOptions[0]!.textContent).toContain('Сохранённая модель недоступна');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  expect(host.textContent).toContain('Выберите разрешённую подключённую модель');
  expect(writes()).toHaveLength(0);
});
