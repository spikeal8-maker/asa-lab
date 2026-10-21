// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAdminPage } from '../AdminAiPage';
import { call } from '../admin-api';
import { aiAdminFixture } from './ai-admin-config.fixture';

vi.mock('../admin-api', () => ({ call: vi.fn() }));

const CONFIG = aiAdminFixture({
  enabled: false,
  paidOperationsPerHour: 0,
  provider: 'openai',
  model: 'gpt-6-luna',
  apiKeyConfigured: false,
  encryptionReady: true,
  keyFingerprint: null,
  configurationVersion: 1,
  updatedAt: '2026-10-18T12:00:00Z',
});
const DEEPSEEK = aiAdminFixture({
  provider: 'deepseek',
  model: 'deepseek-flash',
  apiKeyConfigured: true,
  keyFingerprint: 'a1b2c3d4e5f6',
  paidOperationsPerHour: 5,
  configurationVersion: 2,
});

let root: Root;
let host: HTMLDivElement;
const denied = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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

async function render(data: unknown = CONFIG) {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data });
  await mount();
}

async function mount() {
  await act(async () => {
    root.render(createElement(AiAdminPage, { onAccessDenied: denied }));
  });
}

function button(label: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === label)!;
}

function input(type: string): HTMLInputElement {
  return host.querySelector<HTMLInputElement>(`input[type="${type}"]`)!;
}

function checkbox(label: string): HTMLInputElement {
  return [...host.querySelectorAll('label')]
    .find((item) => item.textContent?.includes(label))!
    .querySelector('input')!;
}

async function enter(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function chooseProvider(value: string) {
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Провайдер"]')!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('DeepSeek admin configuration', () => {
  it('offers the official DeepSeek model for first setup with a masked key and safe quota', async () => {
    await render();
    await chooseProvider('deepseek');
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Провайдер"]')!.value).toBe(
      'deepseek',
    );
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Модель"]')!.value).toBe(
      'deepseek-flash',
    );
    expect(host.textContent).toContain('https://api.deepseek.com/chat/completions');
    expect(host.querySelector('a[href="https://platform.deepseek.com/api_keys"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Подключение GPT');
    expect(input('password').autocomplete).toBe('new-password');
    expect(input('password').required).toBe(true);
    expect(input('number').value).toBe('0');
    expect(host.textContent).toContain('Установите лимит больше 0');
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('preserves an existing OpenAI configuration instead of silently switching providers', async () => {
    await render(
      aiAdminFixture({ model: 'gpt-5-mini', configurationVersion: 4, apiKeyConfigured: true }),
    );
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Провайдер"]')!.value).toBe(
      'openai',
    );
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Модель"]')!.value).toBe(
      'gpt-5-mini',
    );
  });

  it('saves DeepSeek, its key, enablement and quota; clears the secret without a paid call', async () => {
    await render();
    await chooseProvider('deepseek');
    await enter(input('password'), '  test-deepseek-api-key  ');
    await enter(input('number'), '5');
    await act(async () => checkbox('Разрешить ИИ-запросы').click());
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...DEEPSEEK, enabled: true },
    });
    await submit();
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/ai', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: true,
        paidOperationsPerHour: 5,
        provider: 'deepseek',
        model: 'deepseek-flash',
        configurationVersion: 1,
        apiKey: 'test-deepseek-api-key',
      }),
    });
    expect(input('password').value).toBe('');
    expect(host.textContent).toContain('Настройки сохранены');
    expect(host.textContent).not.toContain('test-deepseek-api-key');
    expect(vi.mocked(call).mock.calls.some(([url]) => url.endsWith('/test'))).toBe(false);
  });

  it('does not send a typed key to a different provider after switching', async () => {
    await render(DEEPSEEK);
    await enter(input('password'), 'test-deepseek-api-key');
    await chooseProvider('openai');
    expect(input('password').value).toBe('');
    expect(input('password').required).toBe(true);
    expect(checkbox('Разрешить ИИ-запросы').checked).toBe(false);
    expect(button('Сохранить настройки').disabled).toBe(true);
    await submit();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('waits for a valid save response before claiming success or allowing paid consent', async () => {
    await render(DEEPSEEK);
    await enter(input('number'), '6');
    let confirmSave!: () => void;
    vi.mocked(call).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        confirmSave = resolve;
      });
      return {
        ok: true,
        status: 200,
        data: { ...DEEPSEEK, paidOperationsPerHour: 6, configurationVersion: 3 },
      };
    });
    await submit();
    expect(button('Сохраняем…').disabled).toBe(true);
    expect(host.textContent).not.toContain('Настройки сохранены');
    expect(checkbox('Подтверждаю один платный').disabled).toBe(true);
    await act(async () => confirmSave());
    expect(host.textContent).toContain('Настройки сохранены');
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(checkbox('Подтверждаю один платный').disabled).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('requires explicit billable consent and sends only the saved configuration version', async () => {
    await render(DEEPSEEK);
    expect(button('Проверить подключение').disabled).toBe(true);
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        provider: 'deepseek',
        model: 'deepseek-flash',
        elapsedMs: 1200,
        testedAt: '2026-10-18T12:00:00Z',
        configurationVersion: 2,
      },
    });
    await act(async () => checkbox('Подтверждаю один платный').click());
    expect(button('Проверить подключение').disabled).toBe(false);
    await act(async () => button('Проверить подключение').click());
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/ai/test', {
      method: 'POST',
      body: JSON.stringify({ acknowledgePaidRequest: true, configurationVersion: 2 }),
    });
    expect(host.textContent).toContain('Модель deepseek-flash ответила');
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
  });

  it('invalidates consent when configuration is edited', async () => {
    await render(DEEPSEEK);
    await act(async () => checkbox('Подтверждаю один платный').click());
    await enter(input('number'), '6');
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(host.textContent).toContain('Сначала сохраните настройки');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('preserves the persisted DeepSeek model and saved key through a quota save', async () => {
    await render(DEEPSEEK);
    expect(host.textContent).toContain(DEEPSEEK.keyFingerprint);
    const modelSelect = host.querySelector<HTMLSelectElement>('select[aria-label="Модель"]')!;
    expect([...modelSelect.options].map((option) => option.value)).toEqual([
      'deepseek-flash',
      'deepseek-v4-pro',
    ]);
    expect(modelSelect.value).toBe('deepseek-flash');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain('Сначала сохраните настройки');
    expect(input('password').value).toBe('');
    expect(input('password').required).toBe(false);
    expect(checkbox('Подтверждаю один платный').disabled).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => checkbox('Подтверждаю один платный').click());
    expect(button('Проверить подключение').disabled).toBe(false);
    await enter(input('number'), '6');
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...DEEPSEEK, paidOperationsPerHour: 6, configurationVersion: 3 },
    });
    await submit();
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/ai', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: false,
        paidOperationsPerHour: 6,
        provider: 'deepseek',
        model: 'deepseek-flash',
        configurationVersion: 2,
      }),
    });
    expect(modelSelect.value).toBe('deepseek-flash');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('Настройки сохранены');
    expect(host.textContent).toContain(DEEPSEEK.keyFingerprint);
    expect(checkbox('Подтверждаю один платный').disabled).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(vi.mocked(call).mock.calls.some(([url]) => url.endsWith('/test'))).toBe(false);
  });

  it('keeps paid testing blocked at zero quota even with a configured key', async () => {
    await render({ ...DEEPSEEK, paidOperationsPerHour: 0 });
    expect(host.textContent).toContain('Сохранённый лимит — 0');
    expect(checkbox('Подтверждаю один платный').disabled).toBe(true);
    expect(button('Проверить подключение').disabled).toBe(true);
    await act(async () => checkbox('Подтверждаю один платный').click());
    await act(async () => button('Проверить подключение').click());
    expect(call).toHaveBeenCalledTimes(1);
    await enter(input('number'), '5');
    expect(host.textContent).toContain('Сохранённый лимит — 0');
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(checkbox('Подтверждаю один платный').disabled).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an unsaved zero quota from the active saved quota until save succeeds', async () => {
    await render({ ...DEEPSEEK, enabled: true });
    await act(async () => checkbox('Подтверждаю один платный').click());
    await enter(input('number'), '0');
    expect(host.textContent).toContain('Лимит 0 пока не сохранён');
    expect(host.textContent).toContain('Сейчас действует сохранённый лимит: 5 операций за час');
    expect(host.textContent).not.toContain('Сохранённый лимит — 0');
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: { code: 'ai_config_invalid', message: 'Неверные настройки ИИ.' },
    });
    await submit();
    expect(host.textContent).toContain('Лимит 0 пока не сохранён');
    expect(host.textContent).not.toContain('Настройки сохранены');
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...DEEPSEEK, enabled: true, paidOperationsPerHour: 0, configurationVersion: 3 },
    });
    await submit();
    expect(host.textContent).toContain('Сохранённый лимит — 0');
    expect(host.textContent).not.toContain('Лимит 0 пока не сохранён');
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('clears the saved key only after confirmation and resets paid consent', async () => {
    await render(
      aiAdminFixture({
        provider: 'deepseek',
        model: 'deepseek-flash',
        paidOperationsPerHour: 5,
        apiKeyConfigured: true,
        configurationVersion: 2,
        enabled: true,
        keyFingerprint: 'saved-fingerprint',
      }),
    );
    await act(async () => checkbox('Подтверждаю один платный').click());
    await act(async () => checkbox('Удалить сохранённый API-ключ').click());
    expect(checkbox('Разрешить ИИ-запросы').checked).toBe(false);
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(host.textContent).toContain('saved-fingerprint');
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: aiAdminFixture({
        provider: 'deepseek',
        model: 'deepseek-flash',
        paidOperationsPerHour: 5,
        apiKeyConfigured: false,
        keyFingerprint: null,
        configurationVersion: 3,
      }),
    });
    await submit();
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/ai', {
      method: 'PUT',
      body: JSON.stringify({
        enabled: false,
        paidOperationsPerHour: 5,
        provider: 'deepseek',
        model: 'deepseek-flash',
        configurationVersion: 2,
        clearApiKey: true,
      }),
    });
    expect(host.textContent).toContain('Настройки сохранены');
    expect(host.textContent).not.toContain('saved-fingerprint');
    expect(checkbox('Удалить сохранённый API-ключ').checked).toBe(false);
    expect(checkbox('Удалить сохранённый API-ключ').disabled).toBe(true);
    expect(checkbox('Подтверждаю один платный').disabled).toBe(true);
    expect(input('password').value).toBe('');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('shows server encryption setup and prevents entering a secret until it is ready', async () => {
    await render({ ...DEEPSEEK, encryptionReady: false });
    expect(host.querySelector('[role="alert"]')!.textContent).toContain(
      'ASA_SETTINGS_ENCRYPTION_KEY',
    );
    expect(input('password').disabled).toBe(true);
    expect(checkbox('Разрешить ИИ-запросы').disabled).toBe(true);
    expect(button('Проверить подключение').disabled).toBe(true);
  });
});

describe('AI admin actionable failures', () => {
  it('keeps a rejected save as a draft without claiming success or enabling testing', async () => {
    await render(DEEPSEEK);
    await enter(input('number'), '6');
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: { code: 'ai_config_invalid', message: 'Неверные настройки ИИ.' },
    });
    await submit();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain(
      'Сохранение не подтверждено',
    );
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Модель"]')!.value).toBe(
      'deepseek-flash',
    );
    expect(input('number').value).toBe('6');
    expect(host.textContent).not.toContain('Настройки сохранены');
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each(['deepseek-chat', 'deepseek-unknown'])(
    'rejects an unsupported DeepSeek model from the API: %s',
    async (model) => {
      await render({ ...DEEPSEEK, model });
      expect(host.querySelector('[role="alert"]')!.textContent).toContain('Версия настроек ИИ');
      expect(host.querySelector('form')).toBeNull();
      expect(call).toHaveBeenCalledTimes(1);
    },
  );

  it('does not claim a successful save when the returned schema is unsupported', async () => {
    await render(DEEPSEEK);
    await enter(input('password'), 'test-new-secret-key');
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...DEEPSEEK, model: 'unsupported-model' },
    });
    await submit();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('обновление Web, API');
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).not.toContain('Настройки сохранены');
    expect(host.textContent).not.toContain('test-new-secret-key');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each(['ai_config_unsupported', 'ai_schema_unsupported', 'ai_config_schema_unsupported'])(
    'explains an explicit unsupported schema rejection: %s',
    async (code) => {
      await render(DEEPSEEK);
      vi.mocked(call).mockResolvedValueOnce({
        ok: false,
        status: 400,
        error: { code, message: 'Unsupported schema' },
      });
      await submit();
      expect(host.querySelector('[role="alert"]')!.textContent).toContain(
        'обновление Web, API и миграций',
      );
      expect(host.textContent).not.toContain('Настройки сохранены');
      expect(call).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    [403, 'ai_admin_denied', 'Нет прав.', 'platform_admin'],
    [404, 'not_found', 'Not found', 'обновление Web, API и миграций'],
    [500, 'server_error', 'Internal server error', 'миграции базы'],
    [503, 'ai_encryption_unavailable', 'Шифрование недоступно.', 'ASA_SETTINGS_ENCRYPTION_KEY'],
    [0, 'network', 'Сервер администрирования недоступен.', 'Сервер администрирования недоступен.'],
  ])(
    'explains loading failure %s/%s and offers a safe retry',
    async (status, code, message, text) => {
      vi.mocked(call).mockResolvedValueOnce({ ok: false, status, error: { code, message } });
      await mount();
      expect(host.querySelector('[role="alert"]')!.textContent).toContain(text);
      expect(host.querySelector('form')).toBeNull();
      expect(denied).not.toHaveBeenCalled();
      vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: DEEPSEEK });
      await act(async () => button('Повторить загрузку').click());
      expect(host.querySelector('form')).not.toBeNull();
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(call).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    null,
    '<html>Old deployment</html>',
    { ...CONFIG, configurationVersion: undefined },
    {
      ...CONFIG,
      paidOperationsPerHour: undefined,
    },
  ])('handles an incompatible API response without a blank page: %j', async (data) => {
    await render(data);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Версия настроек ИИ');
    expect(host.querySelector('form')).toBeNull();
  });

  it('hands expired authentication back to the existing access handler', async () => {
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: { code: 'unauthorized', message: 'Войдите.' },
    });
    await mount();
    expect(denied).toHaveBeenCalledOnce();
    expect(host.querySelector('form')).toBeNull();
  });

  it('shows a denied save and clears the typed secret instead of reporting success', async () => {
    await render(DEEPSEEK);
    await enter(input('password'), 'test-new-secret-key');
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: { code: 'ai_admin_denied', message: 'Нет прав.' },
    });
    await submit();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('platform_admin');
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).not.toContain('Настройки сохранены');
    expect(denied).not.toHaveBeenCalled();
  });

  it('distinguishes origin rejection from a missing role', async () => {
    await render(DEEPSEEK);
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: { code: 'ai_origin_denied', message: 'Источник запроса запрещён.' },
    });
    await submit();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('источник запроса');
    expect(host.querySelector('form')).not.toBeNull();
    expect(denied).not.toHaveBeenCalled();
  });

  it('removes the form after a paid-test 403 and requires fresh consent after reloading', async () => {
    await render(DEEPSEEK);
    await act(async () => checkbox('Подтверждаю один платный').click());
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: { code: 'ai_admin_denied', message: 'Нет прав.' },
    });
    await act(async () => button('Проверить подключение').click());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('platform_admin');
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).not.toContain('Модель deepseek-flash ответила');
    vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: DEEPSEEK });
    await act(async () => button('Повторить загрузку').click());
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(denied).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('reloads a changed configuration after a paid-test 409 and requires fresh consent for its version', async () => {
    await render(DEEPSEEK);
    await act(async () => checkbox('Подтверждаю один платный').click());
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: {
        code: 'ai_config_changed',
        message: 'Настройки ИИ изменились. Повторите загрузку перед проверкой.',
      },
    });
    await act(async () => button('Проверить подключение').click());
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/ai/test', {
      method: 'POST',
      body: JSON.stringify({ acknowledgePaidRequest: true, configurationVersion: 2 }),
    });
    expect(host.querySelector('[role="alert"]')!.textContent).toContain(
      'Настройки ИИ изменились. Повторите загрузку перед проверкой.',
    );
    expect(host.querySelector('.asa-ai-admin-success')).toBeNull();
    expect(host.textContent).not.toContain('Модель deepseek-flash ответила');
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    await act(async () => button('Проверить подключение').click());
    expect(call).toHaveBeenCalledTimes(2);

    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...DEEPSEEK, configurationVersion: 3 },
    });
    await act(async () => button('Повторить загрузку').click());
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/ai');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
    await act(async () => button('Проверить подключение').click());
    expect(call).toHaveBeenCalledTimes(3);

    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        provider: 'deepseek',
        model: 'deepseek-flash',
        elapsedMs: 1200,
        testedAt: '2026-10-18T12:01:00Z',
        configurationVersion: 3,
      },
    });
    await act(async () => checkbox('Подтверждаю один платный').click());
    expect(button('Проверить подключение').disabled).toBe(false);
    await act(async () => button('Проверить подключение').click());
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/ai/test', {
      method: 'POST',
      body: JSON.stringify({ acknowledgePaidRequest: true, configurationVersion: 3 }),
    });
    expect(call).toHaveBeenCalledTimes(4);
    expect(host.textContent).toContain('Модель deepseek-flash ответила');
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(button('Проверить подключение').disabled).toBe(true);
  });

  it('shows a provider failure and requires fresh consent for another test', async () => {
    await render(DEEPSEEK);
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'ai_provider_error', message: 'Провайдер отклонил запрос. Проверьте ключ.' },
    });
    await act(async () => checkbox('Подтверждаю один платный').click());
    await act(async () => button('Проверить подключение').click());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Проверьте ключ');
    expect(host.textContent).not.toContain('Модель deepseek-flash ответила');
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
  });

  it.each(['resolved', 'thrown'])(
    'warns that an uncertain paid test may have been billed: %s',
    async (failure) => {
      await render(DEEPSEEK);
      if (failure === 'resolved') {
        vi.mocked(call).mockResolvedValueOnce({
          ok: false,
          status: 0,
          error: { code: 'network', message: 'Сервер администрирования недоступен.' },
        });
      } else {
        vi.mocked(call).mockRejectedValueOnce(new Error('Network failure'));
      }
      await act(async () => button('Проверить подключение').click());
      expect(call).toHaveBeenCalledTimes(1);
      await act(async () => checkbox('Подтверждаю один платный').click());
      await act(async () => button('Проверить подключение').click());
      expect(host.querySelector('[role="alert"]')!.textContent).toContain(
        'Запрос мог быть оплачен',
      );
      expect(checkbox('Подтверждаю один платный').checked).toBe(false);
      expect(button('Проверить подключение').disabled).toBe(true);
      await act(async () => button('Проверить подключение').click());
      expect(call).toHaveBeenCalledTimes(2);
      expect(host.textContent).not.toContain('Модель deepseek-flash ответила');
    },
  );
});

describe('catalog capabilities and confirmed admin operations', () => {
  it('uses the server default and distinguishes image-capable models from enabled product features', async () => {
    await render();
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Модель"]')!.value).toBe(
      'gpt-6-luna',
    );
    const capabilities = host.querySelector('[aria-label="Возможности выбранной модели"]')!;
    expect(capabilities.textContent).toContain('Модель принимает текст и изображения');
    expect(capabilities.textContent).toContain('Загрузка изображений в ASA LabЕщё не подключено');
    expect(capabilities.textContent).toContain('Генерация изображений в ASA LabЕщё не подключено');
    await chooseProvider('deepseek');
    await act(async () => {
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="Модель"]')!;
      select.value = 'deepseek-v4-pro';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(capabilities.textContent).toContain('Модель принимает только текст');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'shows a legacy DeepSeek migration without claiming access (saved key: %s)',
    async (hasKey) => {
      await render(
        aiAdminFixture({
          provider: 'deepseek',
          model: 'deepseek-flash',
          paidOperationsPerHour: 5,
          apiKeyConfigured: hasKey,
          keyFingerprint: hasKey ? 'deepseek-hash' : null,
          configurationVersion: 8,
          migratedFromModel: 'deepseek-chat',
        }),
      );
      expect(host.querySelector('[role="alert"]')!.textContent).toContain(
        'deepseek-chat снята с обслуживания',
      );
      expect(host.textContent).toContain(
        'Доступ к новой модели подтверждается отдельной платной проверкой',
      );
      expect(host.textContent?.includes('Сохранённый ключ перенесён')).toBe(hasKey);
      expect(checkbox('Разрешить ИИ-запросы').checked).toBe(false);
      expect(checkbox('Подтверждаю один платный').checked).toBe(false);
      expect(button('Проверить подключение').disabled).toBe(true);
      expect(host.querySelector('.asa-ai-admin-success')).toBeNull();
      expect(call).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { model: 'deepseek-v4-pro' },
    { provider: 'openai' },
    { configurationVersion: 3 },
    { elapsedMs: -1 },
    { testedAt: 'invalid-date' },
  ])('does not confirm a paid result that is not for this saved request: %j', async (changed) => {
    await render(DEEPSEEK);
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        provider: 'deepseek',
        model: 'deepseek-flash',
        configurationVersion: 2,
        elapsedMs: 120,
        testedAt: '2026-10-19T12:00:00Z',
        ...changed,
      },
    });
    await act(async () => checkbox('Подтверждаю один платный').click());
    await act(async () => button('Проверить подключение').click());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Запрос мог быть оплачен');
    expect(host.querySelector('.asa-ai-admin-success')).toBeNull();
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('admits one paid test for two synchronous clicks before a React rerender', async () => {
    await render(DEEPSEEK);
    let finish!: () => void;
    vi.mocked(call).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        ok: true,
        status: 200,
        data: {
          provider: 'deepseek',
          model: 'deepseek-flash',
          configurationVersion: 2,
          elapsedMs: 120,
          testedAt: '2026-10-19T12:00:00Z',
        },
      };
    });
    await act(async () => checkbox('Подтверждаю один платный').click());
    const verify = button('Проверить подключение');
    await act(async () => {
      verify.click();
      verify.click();
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(button('Проверяем модель…').disabled).toBe(true);
    await act(async () => finish());
    expect(host.textContent).toContain('Модель deepseek-flash ответила');
    expect(checkbox('Подтверждаю один платный').checked).toBe(false);
  });

  it('admits one settings write for two synchronous form submissions', async () => {
    await render(DEEPSEEK);
    let finish!: () => void;
    vi.mocked(call).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { ok: true, status: 200, data: { ...DEEPSEEK, configurationVersion: 3 } };
    });
    const form = host.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => finish());
    expect(host.textContent).toContain('Настройки сохранены');
    expect(call).toHaveBeenCalledTimes(2);
  });
});
