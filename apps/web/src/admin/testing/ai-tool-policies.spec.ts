// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminAiToolPolicies } from '../AdminAiToolPolicies';
import { call } from '../admin-api';

vi.mock('../admin-api', () => ({ call: vi.fn() }));
const tools = [
  {
    id: 'weather',
    label: 'Погода',
    enabled: true,
    instructions: '',
    available: true,
    reason: null,
    usageDescription: 'Когда пользователь спрашивает прогноз названного города.',
    parameters: ['место', 'дата'],
    resultDescription: 'Прогноз с источником',
    hardLimits: ['Только проверенные данные'],
  },
  {
    id: 'web_search',
    label: 'Интернет-поиск',
    enabled: true,
    instructions: '',
    available: true,
    reason: null,
    usageDescription: 'Когда нужны свежие сведения.',
    parameters: ['запрос'],
    resultDescription: 'Ссылки',
    hardLimits: ['Фильтрация URL'],
  },
  {
    id: 'image_search',
    label: 'Поиск изображений',
    enabled: false,
    instructions: '',
    available: false,
    reason: 'Локальная Ollama не вызывает этот инструмент',
    usageDescription: 'Когда нужны существующие картинки.',
    parameters: ['запрос'],
    resultDescription: 'Изображения с источниками',
    hardLimits: ['Без небезопасных ссылок'],
  },
  {
    id: 'generate_image',
    label: 'Генерация изображений',
    enabled: false,
    instructions: '',
    available: false,
    reason: 'Генератор не подключён',
    usageDescription: 'Когда нужно новое изображение.',
    parameters: ['описание'],
    resultDescription: 'Изображение',
    hardLimits: ['Лимит размера'],
  },
] as const;
const fixture = (configurationVersion = 3) => ({ schemaVersion: 1, configurationVersion, tools });
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
  await act(async () =>
    root.render(createElement(AdminAiToolPolicies, { onAccessDenied: denied })),
  );
}
function card(id: string) {
  return host.querySelector<HTMLElement>(`[aria-label="${id}"]`)!;
}
async function input(field: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function save() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

it('loads actual server state and presents immutable limits alongside editable controls', async () => {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: fixture() });
  await render();
  expect(card('Погода').textContent).toContain('Прогноз с источником');
  expect(card('Погода').textContent).toContain('Когда пользователь спрашивает прогноз');
  expect(card('Погода').textContent).toContain('Только проверенные данные');
  expect(card('Поиск изображений').textContent).toContain('Локальная Ollama');
  expect(card('Поиск изображений').querySelector('input')!.disabled).toBe(true);
  expect(card('Видео — скоро').querySelector('input')).toBeNull();
});

it('saves every tool separately from global prompt with revision and request ID', async () => {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: fixture() });
  await render();
  await act(async () => card('Погода').querySelector('input')!.click());
  await input(card('Погода').querySelector('textarea')!, 'Отвечай кратко.');
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: {
      ...fixture(4),
      tools: tools.map((tool) =>
        tool.id === 'weather' ? { ...tool, enabled: false, instructions: 'Отвечай кратко.' } : tool,
      ),
    },
  });
  await save();
  const write = vi.mocked(call).mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(write[0]).toBe('/api/admin/ai/tool-policy');
  expect(JSON.parse(String(write[1]?.body))).toMatchObject({
    schemaVersion: 1,
    expectedConfigurationVersion: 3,
  });
  expect(JSON.parse(String(write[1]?.body)).tools).toHaveLength(4);
  expect(JSON.parse(String(write[1]?.body)).tools[0]).toEqual({
    id: 'weather',
    enabled: false,
    instructions: 'Отвечай кратко.',
  });
  expect(JSON.parse(String(write[1]?.body)).requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(host.textContent).toContain('Настройки инструментов сохранены');
});

it('preserves edits and blocks a stale revision after conflict', async () => {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: fixture() });
  await render();
  await input(card('Погода').querySelector('textarea')!, 'Мой текст');
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 409,
    error: { code: 'conflict', message: 'private' },
  });
  await save();
  expect(card('Погода').querySelector('textarea')!.value).toBe('Мой текст');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  expect(host.textContent).not.toContain('private');
});

it('does not invent current settings when endpoint is missing and routes access denial', async () => {
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 404,
    error: { code: 'missing', message: 'private' },
  });
  await render();
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).toContain('Текущее состояние неизвестно');
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 403,
    error: { code: 'forbidden', message: 'private' },
  });
  await act(async () => host.querySelector('button')!.click());
  expect(denied).toHaveBeenCalledOnce();
});

it('reconciles an unknown write outcome without claiming that request was saved', async () => {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: fixture() });
  await render();
  await input(card('Погода').querySelector('textarea')!, 'Кратко');
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 0,
    error: { code: 'network', message: 'private' },
  });
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: {
      ...fixture(4),
      tools: tools.map((tool) =>
        tool.id === 'weather' ? { ...tool, instructions: 'Кратко' } : tool,
      ),
    },
  });
  await save();
  expect(host.textContent).toContain('Подтверждение исходного запроса не получено');
  expect(host.textContent).not.toContain('Настройки инструментов сохранены');
});

it.each([404, 401, 403, 0, 200])(
  'hides stale status after refresh failure %s and restores a draft on a valid GET',
  async (status) => {
    vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: fixture() });
    await render();
    await input(card('Погода').querySelector('textarea')!, 'Черновик');
    vi.mocked(call).mockResolvedValueOnce(
      status === 200
        ? { ok: true, status: 200, data: { invalid: true } }
        : { ok: false, status, error: { code: 'unavailable', message: 'private' } },
    );
    await act(async () => host.querySelector<HTMLButtonElement>('.asa-ai-tools-refresh')!.click());
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).not.toContain('Доступен');
    expect(host.textContent).toContain('Состояние инструментов неизвестно');
    await saveIfPresent();
    expect(vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    if (status === 401 || status === 403) expect(denied).toHaveBeenCalledOnce();
    vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: fixture() });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.asa-cloud-error button')!.click(),
    );
    expect(card('Погода').querySelector('textarea')!.value).toBe('Черновик');
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  },
);

async function saveIfPresent() {
  const form = host.querySelector('form');
  if (form)
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
}

it('keeps a draft but requires explicit discard when refreshed revision changed', async () => {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: fixture() });
  await render();
  await input(card('Погода').querySelector('textarea')!, 'Черновик');
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: fixture(4) });
  await act(async () => host.querySelector<HTMLButtonElement>('.asa-ai-tools-refresh')!.click());
  expect(card('Погода').querySelector('textarea')!.value).toBe('Черновик');
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Сбросить черновик'))!
      .click(),
  );
  expect(card('Погода').querySelector('textarea')!.value).toBe('');
});

it('hides stale cards when reconciliation GET also fails after an uncertain PUT', async () => {
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: fixture() });
  await render();
  await input(card('Погода').querySelector('textarea')!, 'Черновик');
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 0,
    error: { code: 'network', message: 'private' },
  });
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 403,
    error: { code: 'forbidden', message: 'private' },
  });
  await save();
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).toContain('Состояние инструментов неизвестно');
  expect(denied).toHaveBeenCalledOnce();
});
