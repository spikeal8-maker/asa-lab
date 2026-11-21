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
const config = aiAdminFixture({
  enabled: true,
  provider: 'openai',
  model: 'gpt-6-luna',
  paidOperationsPerHour: 0,
  apiKeyConfigured: true,
  encryptionReady: true,
  configurationVersion: 1,
  updatedAt: null,
});
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
async function show(limit: number) {
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { ...config, paidOperationsPerHour: limit },
  });
  await act(async () =>
    root.render(createElement(AiAdminPage, { onAccessDenied: vi.fn(), providerChoice: 'openai' })),
  );
}
function save() {
  return [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Сохранить'),
  ) as HTMLButtonElement;
}
describe('Compact AI cloud paid quota', () => {
  it('makes the zero default visible and does not authorize paid inference', async () => {
    await show(0);
    const quota = host.querySelector<HTMLInputElement>('input[type=number]')!;
    expect(quota.value).toBe('0');
    expect(quota.min).toBe('0');
    expect(quota.step).toBe('1');
    expect(save().disabled).toBe(true);
    const consent = host.querySelector<HTMLInputElement>('input[type=checkbox]:not(:first-child)');
    expect(host.textContent).toContain('Лимит платных запросов/ч');
    expect(host.textContent).toContain('задайте лимит больше нуля');
    expect(call).toHaveBeenCalledTimes(1);
    expect(consent?.checked).not.toBe(true);
  });
  it('one click can recheck the saved configuration only after consent', async () => {
    await show(7);
    expect(save().disabled).toBe(true);
    const checkbox = [...host.querySelectorAll('label')]
      .find((x) => x.textContent?.includes('Разрешаю один платный'))!
      .querySelector('input')!;
    await act(async () => checkbox.click());
    expect(save().disabled).toBe(false);
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        provider: 'openai',
        model: 'gpt-6-luna',
        configurationVersion: 1,
        elapsedMs: 450,
        testedAt: '2026-10-24T00:01:00Z',
        providerConfigurationVersion: 1,
      },
    });
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/ai/test', {
      method: 'POST',
      body: JSON.stringify({
        acknowledgePaidRequest: true,
        configurationVersion: 1,
        provider: 'openai',
        providerConfigurationVersion: 1,
      }),
    });
    expect(host.textContent).toContain('Подключено · OpenAI · 0.5 с');
  });
});
