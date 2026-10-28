// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminAiTokenBudgets, budgetLimit, budgetAdminShape } from '../AdminAiTokenBudgets';
import { call } from '../admin-api';
vi.mock('../admin-api', () => ({ call: vi.fn() }));
const config = {
  configurationVersion: 3,
  resetAt: '2026-11-01T00:00:00Z',
  models: [
    {
      model: 'ollama-local',
      globalLimit: '12',
      userLimit: null,
      used: '15',
      held: '0',
      unresolved: false,
      pendingUnknown: false,
    },
  ],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(call).mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('shows actual overage, separate save semantics and UTC reset with truthful scope labels', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: config });
  await act(async () =>
    root.render(createElement(AdminAiTokenBudgets, { onAccessDenied: vi.fn() })),
  );
  expect(host.textContent).toContain('Подтверждено токенов всего: 15');
  expect(host.textContent).toContain('Остаток: 0');
  expect(host.textContent).toContain('начатый ответ завершается полностью');
  expect(host.textContent).toContain('UTC');
  expect(host.textContent).toContain('единый слот');
  expect(host.querySelector('button')?.textContent).toBe('Сохранить лимиты токенов');
});
it('preserves a draft and mutation identity across uncertain retries; CAS conflict stays visible', async () => {
  const bodies: string[] = [];
  vi.mocked(call).mockImplementation(async (_url, init) => {
    if (!init) return { ok: true, status: 200, data: config };
    bodies.push(String(init.body));
    return {
      ok: false,
      status: 409,
      error: { code: 'ai_budget_changed', message: 'Лимиты изменились. Черновик остаётся.' },
    };
  });
  await act(async () =>
    root.render(createElement(AdminAiTokenBudgets, { onAccessDenied: vi.fn() })),
  );
  const form = host.querySelector('form')!;
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(host.textContent).toContain('Черновик остаётся');
  expect(host.querySelector('input')?.value).toBe('12');
  await act(async () =>
    root.render(createElement(AdminAiTokenBudgets, { onAccessDenied: vi.fn() })),
  );
  expect(vi.mocked(call).mock.calls.filter(([, init]) => !init)).toHaveLength(1);
  expect(host.querySelector('input')?.value).toBe('12');
});
it('distinguishes blank unlimited from zero and rejects invalid server data', () => {
  expect(budgetLimit(' ')).toBeNull();
  expect(budgetLimit('0')).toBe('0');
  expect(() => budgetLimit('-1')).toThrow();
  expect(() => budgetLimit('1e2')).toThrow();
  expect(budgetAdminShape(config)).toBe(true);
  expect(budgetAdminShape({ ...config, models: [{ ...config.models[0], used: 'NaN' }] })).toBe(
    false,
  );
});

it('omits ineligible model rows while preserving their stored limits in the full CAS save', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: config });
  await act(async () =>
    root.render(
      createElement(AdminAiTokenBudgets, {
        onAccessDenied: vi.fn(),
        eligibleModels: [],
      }),
    ),
  );
  expect(host.querySelector('fieldset')).toBeNull();
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  const payload = JSON.parse(String(vi.mocked(call).mock.calls[1]![1]?.body));
  expect(payload.configurationVersion).toBe(3);
  expect(payload.models).toEqual([{ model: 'ollama-local', globalLimit: '12', userLimit: null }]);
});
