// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AI_TOOL_IDS } from '@asa-lab/contracts';
import { AdminAiTools } from '../AdminAiTools';
import { call } from '../admin-api';

vi.mock('../admin-api', () => ({ call: vi.fn() }));
vi.mock('../AdminAiImages', () => ({ AdminAiImages: () => null }));
const policy = {
  schemaVersion: 1,
  configurationVersion: 7,
  tools: AI_TOOL_IDS.map((id) => ({
    id,
    label: id,
    enabled: true,
    instructions: '',
    available: true,
    reason: null,
    parameters: ['query'],
    resultDescription: 'Result',
    hardLimits: ['Owned scope'],
  })),
};
const network = {
  schemaVersion: 1,
  provider: 'searxng',
  configurationVersion: 4,
  enabled: true,
  configured: true,
  weatherEnabled: true,
  weatherConfigured: true,
  operationsPerHour: 100,
  resultsLimit: 8,
  pagesLimit: 2,
  pageCharLimit: 4500,
  allowedDomains: [],
  blockedDomains: [],
  searchInstructions: '',
};
let root: Root;
let host: HTMLDivElement;
const dirty = vi.fn();
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dirty.mockReset();
  vi.mocked(call)
    .mockReset()
    .mockImplementation(async (path) => ({
      ok: true,
      status: 200,
      data: path.endsWith('tool-policy') ? policy : network,
    }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(AdminAiTools, { onAccessDenied: vi.fn(), onDirtyChange: dirty })),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function select(id: string) {
  await act(async () => host.querySelector<HTMLButtonElement>('#ai-tool-tab-' + id)!.click());
}
async function enter(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('retains unsaved tool permissions and network drafts across tool tabs, saving all eight permissions', async () => {
  await enter('[aria-label="Результатов поиска"]', '5');
  await select('weather');
  const weather = host.querySelector<HTMLElement>('article[aria-label="Погода"]')!;
  await act(async () => weather.querySelector<HTMLInputElement>('input')!.click());
  await select('web_search');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Результатов поиска"]')!.value).toBe(
    '5',
  );
  expect(weather.hidden).toBe(true);
  expect(weather.querySelector<HTMLInputElement>('input')!.checked).toBe(false);
  expect(dirty).toHaveBeenLastCalledWith(true);
  await act(async () =>
    host
      .querySelector('.asa-ai-tools form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  const writes = vi.mocked(call).mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(writes).toHaveLength(1);
  const payload = JSON.parse(String(writes[0]![1]!.body));
  expect(payload.expectedConfigurationVersion).toBe(7);
  expect(payload.tools.map((tool: { id: string }) => tool.id)).toEqual(AI_TOOL_IDS);
  expect(payload.tools.find((tool: { id: string }) => tool.id === 'weather').enabled).toBe(false);
  // Saving access must not also submit the unsaved network configuration.
  expect(writes[0]![0]).toBe('/api/admin/v1/ai/tool-policy');
});

it('shows page-reading limits on its own tab and preserves hidden network values when saving', async () => {
  await select('read_page');
  const results = host.querySelector<HTMLInputElement>('[aria-label="Результатов поиска"]')!;
  expect(results.closest('label')!.hidden).toBe(true);
  const pages = host.querySelector<HTMLInputElement>('[aria-label="Страниц для чтения"]')!;
  expect(pages.closest('label')!.hidden).toBe(false);
  await enter('[aria-label="Страниц для чтения"]', '1');
  await act(async () =>
    host
      .querySelector('.asa-ai-web-admin form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  const write = vi.mocked(call).mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(String(write[1]!.body))).toMatchObject({
    configurationVersion: 4,
    pagesLimit: 1,
    resultsLimit: 8,
    pageCharLimit: 4500,
    weatherEnabled: true,
  });
});

it('supports keyboard selection without dropping the current draft', async () => {
  await enter('[aria-label="Результатов поиска"]', '4');
  const first = host.querySelector<HTMLButtonElement>('#ai-tool-tab-web_search')!;
  await act(async () =>
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  expect(document.activeElement?.id).toBe('ai-tool-tab-read_page');
  expect(host.querySelector('[aria-selected=true]')?.id).toBe('ai-tool-tab-read_page');
  expect(host.querySelector<HTMLInputElement>('[aria-label="Результатов поиска"]')!.value).toBe(
    '4',
  );
});
