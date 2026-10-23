// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAdminPage } from '../AdminAiPage';
import { call } from '../admin-api';
import { aiAdminFixture } from './ai-admin-config.fixture';

vi.mock('../admin-api', () => ({ call: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
const denied = vi.fn();

const EMPTY = aiAdminFixture({
  provider: 'openai',
  model: 'gpt-6-luna',
  enabled: false,
  apiKeyConfigured: false,
  paidOperationsPerHour: 0,
  configurationVersion: 1,
});
const READY = aiAdminFixture({
  provider: 'deepseek',
  model: 'deepseek-flash',
  enabled: true,
  apiKeyConfigured: true,
  paidOperationsPerHour: 5,
  configurationVersion: 7,
});

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

async function renderCloud(config = EMPTY, providerChoice: 'openai' | 'deepseek' = 'openai') {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: config });
  await act(async () => {
    root.render(createElement(AiAdminPage, { onAccessDenied: denied, providerChoice }));
  });
}
function control<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = host.querySelector<T>(selector);
  if (!found) throw new Error('Missing control ' + selector);
  return found;
}
function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((x) => x.textContent?.trim() === name);
  if (!found) throw new Error('Missing button ' + name);
  return found;
}
async function enter(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function toggle(field: HTMLInputElement) {
  await act(async () => field.click());
}
async function submit() {
  await act(async () => {
    control<HTMLFormElement>('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
}
function checkbox(label: string) {
  const match = [...host.querySelectorAll('label')].find((x) => x.textContent?.includes(label));
  if (!match) throw new Error('Checkbox ' + label + ' missing');
  return match.querySelector<HTMLInputElement>('input[type=checkbox]')!;
}

describe('Compact cloud provider connections', () => {
  it('shows a short clear form with only one save action and no keys in HTML', async () => {
    await renderCloud();
    expect(host.textContent).toContain('OpenAI');
    expect(control<HTMLSelectElement>('select[aria-label="Модель"]').value).toBe('gpt-6-luna');
    expect(control<HTMLInputElement>('input[type=password]').value).toBe('');
    expect(control<HTMLInputElement>('input[type=number]').value).toBe('0');
    expect(button('Сохранить выключенным').disabled).toBe(true);
    expect(host.textContent).not.toContain('Отпечаток');
    expect(host.textContent).not.toContain('3. Проверка подключения');
    expect(host.textContent).not.toContain('Состояние ИИ');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('allows disabled DeepSeek key setup without sending a paid request', async () => {
    await renderCloud(EMPTY, 'deepseek');
    expect(control<HTMLSelectElement>('select[aria-label="Модель"]').value).toBe('deepseek-flash');
    await enter(control<HTMLInputElement>('input[type=password]'), 'test-deepseek-new-key');
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: aiAdminFixture({
        provider: 'deepseek',
        model: 'deepseek-flash',
        enabled: false,
        apiKeyConfigured: true,
        paidOperationsPerHour: 0,
        configurationVersion: 2,
      }),
    });
    await submit();
    expect(call).toHaveBeenCalledWith(
      '/api/admin/v1/ai',
      expect.objectContaining({ method: 'PUT' }),
    );
    const write = vi
      .mocked(call)
      .mock.calls.find(([url, init]) => url === '/api/admin/v1/ai' && init?.method === 'PUT');
    expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-flash',
      enabled: false,
      apiKey: 'test-deepseek-new-key',
      paidOperationsPerHour: 0,
    });
    expect(vi.mocked(call).mock.calls.some(([url]) => url.endsWith('/test'))).toBe(false);
    expect(host.textContent).not.toContain('test-deepseek-new-key');
    expect(control<HTMLInputElement>('input[type=password]').value).toBe('');
  });

  it('requires a positive quota and explicit consent before a single paid test', async () => {
    await renderCloud(READY, 'deepseek');
    expect(checkbox('Разрешаю один платный запрос').checked).toBe(false);
    expect(button('Сохранить и проверить').disabled).toBe(true);
    await toggle(checkbox('Разрешаю один платный запрос'));
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        provider: 'deepseek',
        model: 'deepseek-flash',
        elapsedMs: 1200,
        testedAt: '2026-10-24T00:01:00Z',
        configurationVersion: 7,
      },
    });
    await submit();
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/ai/test', {
      method: 'POST',
      body: JSON.stringify({ acknowledgePaidRequest: true, configurationVersion: 7 }),
    });
    expect(host.textContent).toContain('Подключено · DeepSeek · 1.2 с');
    expect(checkbox('Разрешаю один платный запрос').checked).toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('saves changed data then tests in the same action with the new version', async () => {
    await renderCloud(READY, 'deepseek');
    await enter(control<HTMLInputElement>('input[type=number]'), '6');
    await toggle(checkbox('Разрешаю один платный запрос'));
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...READY, configurationVersion: 8, paidOperationsPerHour: 6 },
    });
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        provider: 'deepseek',
        model: 'deepseek-flash',
        configurationVersion: 8,
        elapsedMs: 975,
        testedAt: '2026-10-24T00:01:00Z',
      },
    });
    await submit();
    expect(vi.mocked(call).mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/v1/ai',
      '/api/admin/v1/ai',
      '/api/admin/v1/ai/test',
    ]);
    expect(host.textContent).toContain('Подключено · DeepSeek · 1.0 с');
    expect(control<HTMLInputElement>('input[type=number]').value).toBe('6');
  });

  it('does not claim verification when a saved configuration fails the paid check', async () => {
    await renderCloud(READY, 'deepseek');
    await enter(control<HTMLInputElement>('input[type=number]'), '7');
    await toggle(checkbox('Разрешаю один платный запрос'));
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...READY, configurationVersion: 8, paidOperationsPerHour: 7 },
    });
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 502,
      error: { code: 'ai_provider_authentication_failed', message: 'REMOTE_SECRET_DO_NOT_RENDER' },
    });
    await submit();
    expect(host.textContent).toContain('Настройки сохранены, но подключение не подтверждено');
    expect(host.textContent).not.toContain('REMOTE_SECRET_DO_NOT_RENDER');
    expect(host.textContent).not.toContain('Подключено ·');
    expect(checkbox('Разрешаю один платный запрос').checked).toBe(false);
  });

  it('never tests a zero-quota provider', async () => {
    await renderCloud({ ...READY, paidOperationsPerHour: 0 }, 'deepseek');
    expect(button('Сохранить и проверить').disabled).toBe(true);
    expect(checkbox('Разрешаю один платный запрос').disabled).toBe(true);
    expect(host.textContent).toContain('задайте лимит больше нуля');
    expect(vi.mocked(call).mock.calls.some(([url]) => url.endsWith('/test'))).toBe(false);
  });

  it('fails closed on a stale-save conflict and never starts the paid check', async () => {
    await renderCloud(READY, 'deepseek');
    await enter(control<HTMLInputElement>('input[type=number]'), '9');
    await toggle(checkbox('Разрешаю один платный запрос'));
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'ai_config_changed', message: 'stale' },
    });
    await submit();
    expect(host.textContent).toContain('Настройки ИИ изменились');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('exposes key deletion only under the advanced section and without cloud test', async () => {
    await renderCloud(READY, 'deepseek');
    expect(control<HTMLDetailsElement>('details').open).toBe(false);
    await toggle(checkbox('Удалить сохранённый ключ'));
    expect(button('Сохранить выключенным').disabled).toBe(false);
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...READY, enabled: false, apiKeyConfigured: false, configurationVersion: 8 },
    });
    await submit();
    const body = vi.mocked(call).mock.calls[1]?.[1]?.body;
    expect(JSON.parse(String(body))).toMatchObject({ clearApiKey: true, enabled: false });
    expect(call).toHaveBeenCalledTimes(2);
  });
});
