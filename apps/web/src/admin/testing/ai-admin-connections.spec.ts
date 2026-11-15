// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AiAdminWorkspace } from '../AiAdminWorkspace';
import { call } from '../admin-api';
import { aiAdminFixture } from './ai-admin-config.fixture';
import { generationPolicyFixture } from './ai-generation-policy.fixture';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
it('keeps a pending provider switch on cancelled navigation and confirms discard before Settings', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  window.history.replaceState(null, '', '/#/admin/ai?section=connections&provider=deepseek');
  vi.mocked(call).mockImplementation(async (url) => ({
    ok: true,
    status: 200,
    data:
      url === '/api/admin/v1/ai'
        ? aiAdminFixture({
            provider: 'deepseek',
            model: 'deepseek-flash',
            enabled: true,
            apiKeyConfigured: true,
            paidOperationsPerHour: 5,
          })
        : url.includes('generation-policy')
          ? generationPolicyFixture()
          : url.includes('token-budgets')
            ? { configurationVersion: 1, resetAt: '2026-11-01T00:00:00Z', models: [] }
            : { enabled: false },
  }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  try {
    await act(async () =>
      root.render(
        createElement(AiAdminWorkspace, { principalId: 'fixture-owner', onAccessDenied: vi.fn() }),
      ),
    );
    const toggle = host.querySelector<HTMLInputElement>('.asa-cloud-enabled input')!;
    await act(async () => toggle.click());
    expect(host.textContent).toContain('Есть несохранённые изменения');
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    const settings = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(
      (button) => button.textContent === 'Настройки',
    )!;
    await act(async () => settings.click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(settings.getAttribute('aria-selected')).toBe('false');
    expect(toggle.checked).toBe(false);
    expect(vi.mocked(call).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
    confirm.mockReturnValue(true);
    await act(async () => settings.click());
    expect(settings.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[aria-label="Разрешить у провайдера DeepSeek Flash"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  }
});
