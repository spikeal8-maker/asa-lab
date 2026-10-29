// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AiAdminWorkspace } from '../AiAdminWorkspace';

vi.mock('../admin-api', () => ({
  call: vi.fn(async () => ({
    ok: false,
    status: 503,
    error: { code: 'offline', message: 'Fixture offline' },
  })),
}));

vi.mock('../AdminAiGenerationPolicy', () => ({ AdminAiGenerationPolicy: () => null }));
vi.mock('../AdminAiTokenBudgets', () => ({ AdminAiTokenBudgets: () => null }));
vi.mock('../AdminAiUsageOverview', () => ({ AdminAiUsageOverview: () => null }));
vi.mock('../AdminAiPage', () => ({ AiAdminPage: () => null }));
vi.mock('../AdminOllamaPage', () => ({ AdminOllamaPage: () => null }));
vi.mock('../AdminComfyUiPage', () => ({ AdminComfyUiPage: () => null }));
vi.mock('../AdminAiWebSearch', () => ({ AdminAiWebSearch: () => null }));

it('mounts the theme opt-in only for Connections and Settings and removes it on navigation and unmount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/#/admin/ai?section=settings');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const bodyClass = document.body.className;
  const htmlClass = document.documentElement.className;
  const bodyStyle = document.body.getAttribute('style');
  try {
    await act(async () =>
      root.render(
        createElement(AiAdminWorkspace, {
          principalId: 'settings-theme-test',
          onAccessDenied: vi.fn(),
        }),
      ),
    );
    expect(host.querySelector('.asa-ai-settings')?.id).toBe('ai-panel-settings');
    for (const section of [
      'prompt',
      'connections',
      'settings',
      'overview',
      'connections',
      'settings',
    ]) {
      const tab = host.querySelector<HTMLButtonElement>('#ai-tab-' + section)!;
      await act(async () => tab.click());
      expect(host.querySelectorAll('.asa-ai-settings')).toHaveLength(
        section === 'settings' || section === 'connections' ? 1 : 0,
      );
      expect(document.body.className).toBe(bodyClass);
      expect(document.documentElement.className).toBe(htmlClass);
      expect(document.body.getAttribute('style')).toBe(bodyStyle);
    }
  } finally {
    await act(async () => root.unmount());
    expect(host.querySelector('.asa-ai-settings')).toBeNull();
    host.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
