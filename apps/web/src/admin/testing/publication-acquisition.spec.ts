// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicationAcquisitionSettings } from '../PublicationAcquisitionSettings';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
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
it('requires reason and sends the displayed CAS; conflict removes stale switch and offers reload', async () => {
  vi.mocked(call)
    .mockResolvedValueOnce({ ok: true, status: 200, data: { enabled: false, version: 7 } })
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'conflict', message: 'private' },
    });
  await act(async () =>
    root.render(createElement(PublicationAcquisitionSettings, { onAccessDenied: vi.fn() })),
  );
  expect(host.textContent).toContain('запрещено');
  expect(host.querySelector('button')!.disabled).toBe(true);
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'Explicit permission',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => host.querySelector('button')!.click());
  expect(call).toHaveBeenLastCalledWith('/api/admin/v1/publications/acquisition', {
    method: 'POST',
    body: JSON.stringify({ enabled: true, expectedVersion: 7, reason: 'Explicit permission' }),
  });
  expect(host.querySelector('input')).toBeNull();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('изменилась');
  expect(host.textContent).not.toContain('private');
});
