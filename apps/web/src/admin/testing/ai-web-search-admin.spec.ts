// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminAiWebSearch } from '../AdminAiWebSearch';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
const config = {
  schemaVersion: 1,
  provider: 'searxng',
  enabled: true,
  configured: true,
  weatherConfigured: true,
  weatherEnabled: true,
  operationsPerHour: 100,
  configurationVersion: 4,
};
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
async function render() {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: config });
  await act(async () => root.render(createElement(AdminAiWebSearch, { onAccessDenied: denied })));
}
async function submit() {
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
it('has no credential or endpoint inputs and saves only server-owned enablement and budget settings', async () => {
  await render();
  expect(host.querySelectorAll('input[type=password]')).toHaveLength(0);
  expect(vi.mocked(call)).toHaveBeenCalledTimes(1);
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { ...config, configurationVersion: 5 },
  });
  await submit();
  const [url, request] = vi.mocked(call).mock.calls[1]!;
  expect(url).toBe('/api/admin/v1/ai/web-search');
  expect(JSON.parse(String(request?.body))).toEqual({
    enabled: true,
    weatherEnabled: true,
    operationsPerHour: 100,
    configurationVersion: 4,
  });
  expect(host.textContent).toContain('Поисковый запрос не выполнялся');
});
it('allows disabling forecast independently and keeps revision errors safe', async () => {
  await render();
  const label = [...host.querySelectorAll('label')].find((item) =>
    item.textContent?.includes('Включить прогноз погоды'),
  )!;
  await act(async () => (label.querySelector('input') as HTMLInputElement).click());
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 409,
    error: { code: 'conflict', message: 'private backend text' },
  });
  await submit();
  expect(JSON.parse(String(vi.mocked(call).mock.calls[1]?.[1]?.body))).toEqual({
    enabled: true,
    weatherEnabled: false,
    operationsPerHour: 100,
    configurationVersion: 4,
  });
  expect(host.textContent).toContain('Настройки изменились');
  expect(host.textContent).not.toContain('private backend text');
});
it('does not expose an editable form when the platform scope is denied', async () => {
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 403,
    error: { code: 'denied', message: 'denied' },
  });
  await act(async () => root.render(createElement(AdminAiWebSearch, { onAccessDenied: denied })));
  expect(denied).toHaveBeenCalledOnce();
  expect(host.querySelector('form')).toBeNull();
});

async function enterArea(name: string, value: string) {
  const field = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function renderWithFilters() {
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: {
      ...config,
      allowedDomains: [],
      blockedDomains: [],
      searchInstructions: '',
    },
  });
  await act(async () => root.render(createElement(AdminAiWebSearch, { onAccessDenied: denied })));
}
it('saves domain filters and search instructions with the unchanged weather policy', async () => {
  await renderWithFilters();
  await enterArea('Разрешённые сайты', 'example.org\nнаука.рф');
  await enterArea('Исключённые сайты', 'ads.example.org');
  await enterArea('Инструкции для ответов с интернет-поиском', 'Кратко сравни первоисточники.');
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: {
      ...config,
      configurationVersion: 5,
      allowedDomains: ['example.org', 'xn--80aa3ak5a.xn--p1ai'],
      blockedDomains: ['ads.example.org'],
      searchInstructions: 'Кратко сравни первоисточники.',
    },
  });
  await submit();
  expect(JSON.parse(String(vi.mocked(call).mock.calls[1]?.[1]?.body))).toEqual({
    enabled: true,
    weatherEnabled: true,
    operationsPerHour: 100,
    configurationVersion: 4,
    allowedDomains: ['example.org', 'наука.рф'],
    blockedDomains: ['ads.example.org'],
    searchInstructions: 'Кратко сравни первоисточники.',
  });
});
it('does not send arbitrary URLs, ports or wildcard domain masks', async () => {
  await renderWithFilters();
  for (const domain of ['https://example.org/path', '*.example.org', 'example.org:443']) {
    await enterArea('Разрешённые сайты', domain);
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    await submit();
  }
  expect(vi.mocked(call)).toHaveBeenCalledTimes(1);
});
