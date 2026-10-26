// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmUserCardLauncher } from '../CrmUserCard';
import { crmApi } from '../crm-user-api';
import { crmProfileFixture, CRM_ID } from './crm-user.fixture';

let host: HTMLDivElement, root: Root;
const modal = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: modal,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  modal.mockClear();
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const kind of ['account', 'student'] as const) {
  it(`opens a full ${kind} card in one modal and returns focus on close or Escape`, async () => {
    const profile = vi.spyOn(crmApi, 'profile').mockResolvedValue({
      ok: true,
      status: 200,
      data: crmProfileFixture(kind),
    });
    await act(async () =>
      root.render(
        createElement(CrmUserCardLauncher, {
          kind,
          targetId: CRM_ID,
          title: 'Длинное имя пользователя',
          trigger: createElement('span', null, 'Длинное имя пользователя'),
          onAccessDenied: vi.fn(),
        }),
      ),
    );
    const row = host.querySelector('button')!;
    expect(host.querySelector('dialog')).toBeNull();
    expect(profile).not.toHaveBeenCalled();
    row.focus();
    await act(async () => row.click());
    expect(modal).toHaveBeenCalledOnce();
    expect(host.querySelectorAll('dialog')).toHaveLength(1);
    const dialog = host.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Длинное имя пользователя');
    expect(dialog.querySelector('h2')?.id).toBe(dialog.getAttribute('aria-labelledby'));
    expect(profile).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => dialog.querySelector('button')!.click());
    expect(host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(document.body.style.overflow).toBe('');
    await act(async () => row.click());
    await act(async () => host.querySelector('dialog')!.dispatchEvent(new Event('cancel')));
    expect(host.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(row);
  });
}
