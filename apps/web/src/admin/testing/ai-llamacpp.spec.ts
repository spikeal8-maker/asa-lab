// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminLlamaCppPage } from '../AdminLlamaCppPage';
import { AiAdminWorkspace } from '../AiAdminWorkspace';
import { policyShape } from '../AdminAiGenerationPolicy';
import { readAiAdminNavigation, rememberAiAdminNavigation } from '../ai-admin-navigation';
import { call } from '../admin-api';
import { aiAdminFixture } from './ai-admin-config.fixture';
import { generationPolicyFixture } from './ai-generation-policy.fixture';

vi.mock('../admin-api', () => ({ call: vi.fn() }));

const initial = {
  enabled: false,
  baseUrl: 'http://llama-server:8080',
  model: '',
  revision: 4,
  updatedAt: null as string | null,
  apiKeyConfigured: false,
  contextTokens: null as number | null,
  confirmedContextTokens: null as number | null,
  contextSource: 'unknown',
  toolsVerified: false,
  temperature: null as number | null,
  topP: null as number | null,
  maxOutputTokens: null as number | null,
};
const available = [{ id: 'fixture-model', contextTokens: 32768, tools: false }];
let config = { ...initial };
let root: Root;
let host: HTMLDivElement;
const denied = vi.fn();
const updated = vi.fn();
const dirty = vi.fn();

const ok = (data: unknown) => ({ ok: true, status: 200, data }) as never;
const failure = (code: string, status: number) =>
  ({
    ok: false,
    status,
    error: { code, message: 'UNTRUSTED UPSTREAM MESSAGE' },
  }) as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  window.history.replaceState(null, '', '/#/admin/ai?section=connections&provider=llamacpp-local');
  config = { ...initial };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockImplementation(async (path, init) => {
    if (path === '/api/admin/v1/ai') return ok(aiAdminFixture());
    if (path.endsWith('/llamacpp/models'))
      return ok({ baseUrl: config.baseUrl, models: available });
    if (path.endsWith('/llamacpp/apply')) {
      const input = JSON.parse(String(init?.body));
      const { apiKey, clearApiKey } = input;
      const next = { ...input };
      delete next.apiKey;
      delete next.apiKeyEndpoint;
      delete next.clearApiKey;
      delete next.requestId;
      config = {
        ...config,
        ...next,
        revision: config.revision + 1,
        apiKeyConfigured: !!apiKey || (config.apiKeyConfigured && !clearApiKey),
      };
      return ok({
        config,
        verified: config.enabled,
        test: config.enabled ? { model: config.model } : null,
      });
    }
    if (path.endsWith('/llamacpp')) return ok(config);
    return ok({ enabled: false });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function render(): Promise<void> {
  await act(async () =>
    root.render(
      createElement(AdminLlamaCppPage, {
        onAccessDenied: denied,
        onUpdated: updated,
        onDirtyChange: dirty,
      }),
    ),
  );
}
async function tick(ms = 450): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function input(label: string): HTMLInputElement {
  return host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}
async function fill(label: string, value: string): Promise<void> {
  await act(async () => {
    const field = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function clickToggle(): Promise<void> {
  await act(async () => input('Включить llama.cpp').click());
}
async function submit(): Promise<void> {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
const requests = (suffix: string) =>
  vi.mocked(call).mock.calls.filter(([path]) => path.endsWith(suffix));
const body = (request: typeof call extends (...args: infer A) => unknown ? A : never) =>
  JSON.parse(String(request[1]?.body));

it('discovers after 450 ms, accepts a bare host and automatically selects the only real model', async () => {
  await render();
  expect(input('Адрес llama.cpp').type).toBe('text');
  await fill('Адрес llama.cpp', 'llama-machine');
  await tick(449);
  expect(requests('/models')).toHaveLength(0);
  await tick(1);
  expect(body(requests('/models')[0]!)).toEqual({ baseUrl: 'llama-machine', revision: 4 });
  expect(host.querySelector('[aria-pressed="true"]')?.textContent).toContain('fixture-model');
  await clickToggle();
  await submit();
  expect(body(requests('/apply')[0]!)).toMatchObject({
    enabled: true,
    model: 'fixture-model',
    baseUrl: 'llama-machine',
    revision: 4,
    contextTokens: null,
    temperature: null,
    topP: null,
    maxOutputTokens: null,
  });
  expect(body(requests('/apply')[0]!).requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(updated).toHaveBeenCalledOnce();
});

it('requires an explicit choice for several models and never invents a model for an empty list', async () => {
  vi.mocked(call).mockImplementation(async (path) =>
    path.endsWith('/models')
      ? ok({
          baseUrl: config.baseUrl,
          models: [...available, { id: 'second-model', contextTokens: null, tools: false }],
        })
      : ok(config),
  );
  await render();
  await tick();
  await clickToggle();
  expect(host.querySelector('[aria-pressed="true"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  const choice = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('second-model'),
  )!;
  await act(async () => choice.click());
  expect(choice.getAttribute('aria-pressed')).toBe('true');
  vi.mocked(call).mockImplementation(async (path) =>
    path.endsWith('/models') ? ok({ baseUrl: config.baseUrl, models: [] }) : ok(config),
  );
  await fill('Адрес llama.cpp', 'empty-server');
  await tick();
  expect(host.textContent?.match(/Модели не найдены/g)).toHaveLength(1);
  expect(host.querySelector('[aria-label="Модели llama.cpp"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});

it('retries discovery after entering a key, binds it to the endpoint and does not treat upstream auth as ASA denial', async () => {
  vi.mocked(call).mockImplementation(async (path, init) =>
    path.endsWith('/models')
      ? JSON.parse(String(init?.body)).apiKey
        ? ok({ baseUrl: config.baseUrl, models: available })
        : failure('ai_llamacpp_auth', 502)
      : ok(config),
  );
  await render();
  await tick();
  expect(host.textContent).toContain('Сервер не принял API-ключ');
  expect(host.textContent).not.toContain('UNTRUSTED');
  expect(denied).not.toHaveBeenCalled();
  await fill('API-ключ llama.cpp', 'fixture-private-key');
  await tick();
  expect(body(requests('/models')[1]!)).toMatchObject({
    apiKey: 'fixture-private-key',
    apiKeyEndpoint: 'http://llama-server:8080',
  });
  expect(input('API-ключ llama.cpp').type).toBe('password');
  expect(host.textContent).not.toContain('fixture-private-key');
  expect(JSON.stringify(localStorage)).not.toContain('fixture-private-key');
  expect(window.location.href).not.toContain('fixture-private-key');
});

it('clears the draft key synchronously on address change and ignores the aborted old discovery response', async () => {
  let resolveOld: (result: never) => void = () => undefined;
  vi.mocked(call).mockImplementation(async (path, init) => {
    if (!path.endsWith('/models')) return ok(config);
    const payload = JSON.parse(String(init?.body));
    if (payload.apiKey)
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return ok({
      baseUrl: payload.baseUrl,
      models: payload.baseUrl === 'new-machine' ? available : [],
    });
  });
  await render();
  await tick();
  await fill('API-ключ llama.cpp', 'fixture-old-secret');
  await tick();
  const old = requests('/models').at(-1)!;
  expect(old[1]?.signal?.aborted).toBe(false);
  await fill('Адрес llama.cpp', 'new-machine');
  expect(input('API-ключ llama.cpp').value).toBe('');
  expect(old[1]?.signal?.aborted).toBe(true);
  await act(async () =>
    resolveOld(
      ok({ baseUrl: config.baseUrl, models: [{ id: 'STALE', contextTokens: 999, tools: true }] }),
    ),
  );
  await tick();
  const latest = body(requests('/models').at(-1)!);
  expect(latest.baseUrl).toBe('new-machine');
  expect(latest).not.toHaveProperty('apiKey');
  expect(latest).not.toHaveProperty('apiKeyEndpoint');
  expect(host.textContent).not.toContain('STALE');
  expect(host.textContent).not.toContain('fixture-old-secret');
});

it('uses a saved server-only key without returning a key to the browser', async () => {
  config = { ...config, enabled: true, apiKeyConfigured: true, model: 'fixture-model' };
  await render();
  await tick();
  expect(input('API-ключ llama.cpp').value).toBe('');
  expect(input('API-ключ llama.cpp').placeholder).toContain('Ключ сохранён');
  expect(body(requests('/models')[0]!)).not.toHaveProperty('apiKey');
});

it('keeps the same request id after an unknown save outcome and clears the entered key only on confirmed success', async () => {
  const original = vi.mocked(call).getMockImplementation()!;
  let unknown = true;
  vi.mocked(call).mockImplementation(async (path, init) => {
    if (path.endsWith('/apply') && unknown) {
      unknown = false;
      return failure('network', 0);
    }
    return original(path, init);
  });
  await render();
  await tick();
  await clickToggle();
  await fill('API-ключ llama.cpp', 'fixture-save-secret');
  await tick();
  await submit();
  expect(config.revision).toBe(4);
  expect(input('API-ключ llama.cpp').value).toBe('fixture-save-secret');
  await submit();
  const saves = requests('/apply').map(body);
  expect(saves).toHaveLength(2);
  expect(saves[0].requestId).toBe(saves[1].requestId);
  expect(input('API-ключ llama.cpp').value).toBe('');
  expect(config.revision).toBe(5);
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it('retains the working config on a revision conflict and offers an explicit reload', async () => {
  const original = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation(async (path, init) =>
    path.endsWith('/apply') ? failure('ai_llamacpp_config_changed', 409) : original(path, init),
  );
  await render();
  await tick();
  await clickToggle();
  await submit();
  expect(config.revision).toBe(4);
  expect(host.textContent).toContain('Настройки изменены другим администратором');
  config = { ...config, revision: 8, baseUrl: 'http://new-saved-server:8080' };
  const reload = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Загрузить настройки',
  )!;
  await act(async () => reload.click());
  expect(input('Адрес llama.cpp').value).toBe(config.baseUrl);
});

it('allows offline disabling and preserves working parameters even when the draft address is incomplete', async () => {
  config = {
    ...config,
    enabled: true,
    model: 'fixture-model',
    contextTokens: 16384,
    apiKeyConfigured: true,
  };
  const original = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation(async (path, init) =>
    path.endsWith('/models') ? failure('ai_llamacpp_unreachable', 503) : original(path, init),
  );
  await render();
  await tick();
  const removeKey = () =>
    host.querySelector<HTMLInputElement>('.asa-ai-ollama-toggle input:not([aria-label])')!;
  await act(async () => removeKey().click());
  await fill('Адрес llama.cpp', 'http://');
  await fill('Температура llama.cpp', '9');
  await clickToggle();
  await submit();
  expect(body(requests('/apply')[0]!)).toMatchObject({
    enabled: false,
    baseUrl: 'http://llama-server:8080',
    model: 'fixture-model',
    contextTokens: 16384,
    temperature: null,
    revision: 4,
  });
  expect(body(requests('/apply')[0]!)).not.toHaveProperty('clearApiKey');
  expect(config.enabled).toBe(false);
  expect(host.textContent).toContain('рабочие параметры сохранены');
  await act(async () => removeKey().click());
  await submit();
  expect(body(requests('/apply')[1]!)).toMatchObject({
    enabled: false,
    baseUrl: 'http://llama-server:8080',
    clearApiKey: true,
    revision: 5,
  });
  expect(body(requests('/apply')[1]!)).not.toHaveProperty('apiKey');
  expect(config.apiKeyConfigured).toBe(false);
});

it('distinguishes metadata context from an administrator limit and rejects invalid generation ranges', async () => {
  await render();
  await tick();
  await clickToggle();
  expect(host.textContent).toContain('Подтверждённый контекст:');
  expect(input('Лимит контекста llama.cpp').max).toBe('32768');
  await fill('Лимит контекста llama.cpp', '16384');
  await fill('Максимальный ответ llama.cpp', '16385');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await fill('Максимальный ответ llama.cpp', '1024');
  await fill('Top P llama.cpp', '0');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await fill('Top P llama.cpp', '0.9');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
});

it('aborts discovery when the page is unmounted', async () => {
  await render();
  await tick();
  const signal = requests('/models')[0]![1]?.signal;
  await act(async () => root.render(null));
  expect(signal?.aborted).toBe(true);
});

it('keeps llama.cpp navigation independent and shows it immediately after Ollama', async () => {
  rememberAiAdminNavigation('other-owner', { section: 'connections', provider: 'ollama' });
  expect(readAiAdminNavigation('owner').provider).toBe('llamacpp-local');
  await act(async () =>
    root.render(createElement(AiAdminWorkspace, { principalId: 'owner', onAccessDenied: denied })),
  );
  const cards = [...host.querySelectorAll('.asa-ai-provider-card strong')].map(
    (node) => node.textContent,
  );
  expect(cards).toEqual(['Ollama', 'llama.cpp', 'Ollama Cloud', 'DeepSeek', 'OpenAI', 'Polza AI']);
  await fill('Адрес llama.cpp', 'edited-machine');
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const ollama = [...host.querySelectorAll<HTMLButtonElement>('.asa-ai-provider-card')].find(
    (button) => button.querySelector('strong')?.textContent === 'Ollama',
  )!;
  await act(async () => ollama.click());
  expect(confirm).toHaveBeenCalledOnce();
  expect(host.querySelector('[aria-label="Настройки llama.cpp"]')).not.toBeNull();
  expect(requests('/apply')).toHaveLength(0);
});

it('accepts the independent local slot in the canonical policy without changing its default or allowlist', () => {
  const policy = generationPolicyFixture();
  const candidate = {
    ...policy,
    models: [
      ...policy.models,
      {
        id: 'llamacpp-local',
        provider: 'llamacpp-local',
        label: 'llama.cpp · fixture-model',
        ready: true,
        selectable: true,
        allowed: false,
      },
    ],
  };
  expect(policyShape(candidate)).toBe(true);
  expect(candidate.defaultModel).toBe(policy.defaultModel);
  expect(candidate.allowedModels).toEqual(policy.allowedModels);
});
