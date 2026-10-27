// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminAiUsageOverview } from '../AdminAiUsageOverview';
import { call } from '../admin-api';
import { formatUsageTokens, isAiUsageOverview } from '../ai-usage-overview-model';
import { usageOverviewFixture } from './ai-usage-overview.fixture';

vi.mock('../admin-api', () => ({ call: vi.fn() }));
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () => {
    root.render(createElement(AdminAiUsageOverview, { onAccessDenied: denied }));
  });
const metric = (name: string) =>
  host.querySelector(`[data-testid="ai-usage-${name}"] .asa-ai-usage-value`)?.textContent;
const click = (name: string) =>
  act(async () => {
    const button = [...host.querySelectorAll('button')].find((entry) => entry.textContent === name);
    expect(button).toBeTruthy();
    button!.click();
  });

it('renders actual totals and all seven calendar days from one API snapshot', async () => {
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: usageOverviewFixture() });
  await render();
  expect(call).toHaveBeenCalledWith(
    '/api/admin/v1/ai/usage-overview',
    expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
  );
  expect(metric('requests')).toBe('9');
  expect(metric('input')).toBe('4\u00a0500');
  expect(metric('output')).toBe('450');
  expect([...host.querySelectorAll('tbody td')].map((cell) => cell.textContent)).toEqual([
    '1',
    '0',
    '2',
    '1',
    '3',
    '0',
    '2',
  ]);
  expect(host.textContent).toContain('Часовой пояс: UTC');
  expect(host.textContent).toContain('Сегодняшний день ещё идёт');
  expect(host.textContent).not.toContain('Данных за период нет');
});

it('keeps partial measured zero distinct from entirely unknown token counts', async () => {
  vi.mocked(call).mockResolvedValue({
    ok: true,
    status: 200,
    data: usageOverviewFixture({
      inputTokens: { known: '0', knownOperations: 1, unknownOperations: 8 },
      outputTokens: { known: null, knownOperations: 0, unknownOperations: 9 },
      state: 'partial',
    }),
  });
  await render();
  expect(metric('input')).toBe('0');
  expect(metric('output')).toBe('Неизвестно');
  expect(host.textContent).toContain('Расход известен не полностью');
  expect(host.textContent).toContain('Учтено операций: 1');
  expect(host.textContent).toContain('Без данных: 8');
  expect(host.textContent).toContain('Без данных: 9');
});

it('renders a successful empty period with zero daily buckets, not an error', async () => {
  const data = usageOverviewFixture();
  vi.mocked(call).mockResolvedValue({
    ok: true,
    status: 200,
    data: usageOverviewFixture({
      requests: 0,
      daily: data.daily.map((day) => ({ ...day, requests: 0 })),
      inputTokens: { known: '0', knownOperations: 0, unknownOperations: 0 },
      outputTokens: { known: '0', knownOperations: 0, unknownOperations: 0 },
      state: 'empty',
    }),
  });
  await render();
  expect(metric('requests')).toBe('0');
  expect(host.textContent).toContain('Данных за период нет');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelectorAll('[data-empty="true"]')).toHaveLength(7);
});

it('never turns a source failure or malformed success into zero; retries the real read path', async () => {
  vi.mocked(call).mockResolvedValueOnce({
    ok: false,
    status: 503,
    error: { code: 'ai_usage_unavailable', message: 'PRIVATE_DATABASE_ERROR' },
  });
  await render();
  expect(host.textContent).toContain('Не удалось загрузить данные');
  expect(host.textContent).not.toContain('PRIVATE_DATABASE_ERROR');
  expect(metric('requests')).toBeUndefined();
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: { requests: 0 } });
  await click('Повторить загрузку');
  expect(host.textContent).toContain('Не удалось загрузить данные');
  vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: usageOverviewFixture() });
  await click('Повторить загрузку');
  expect(metric('requests')).toBe('9');
  expect(call).toHaveBeenCalledTimes(3);
});

it.each([401, 403])(
  'clears displayed aggregates when a refresh loses administrative access (%s)',
  async (status) => {
    vi.mocked(call).mockResolvedValueOnce({ ok: true, status: 200, data: usageOverviewFixture() });
    await render();
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status,
      error: { code: 'denied', message: 'Denied' },
    });
    await click('Обновить данные');
    expect(denied).toHaveBeenCalledOnce();
    expect(metric('requests')).toBeUndefined();
  },
);

it('has a finite loading deadline and ignores a late successful response after timeout', async () => {
  vi.useFakeTimers();
  let finish: (value: Awaited<ReturnType<typeof call>>) => void = () => {
    throw new Error('No request started');
  };
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(host.textContent).toContain('Загружаем данные');
  expect(metric('requests')).toBeUndefined();
  await act(async () => vi.advanceTimersByTime(15_000));
  expect(host.textContent).toContain('Не удалось загрузить данные');
  await act(async () => finish({ ok: true, status: 200, data: usageOverviewFixture() }));
  expect(metric('requests')).toBeUndefined();
});

it('keeps exact token sums beyond safe JavaScript integers and rejects inconsistent snapshots', () => {
  expect(formatUsageTokens('18014398509481982').replace(/\s/g, '')).toBe('18014398509481982');
  expect(formatUsageTokens(null)).toBe('Неизвестно');
  expect(isAiUsageOverview(usageOverviewFixture())).toBe(true);
  expect(isAiUsageOverview(usageOverviewFixture({ requests: 10 }))).toBe(false);
  expect(isAiUsageOverview(usageOverviewFixture({ daily: [] }))).toBe(false);
  expect(
    isAiUsageOverview(
      usageOverviewFixture({
        inputTokens: { known: null, knownOperations: 9, unknownOperations: 0 },
      }),
    ),
  ).toBe(false);
  expect(
    isAiUsageOverview(
      usageOverviewFixture({
        period: {
          from: '2026-10-21T03:00:00Z',
          to: '2026-10-27T12:30:00Z',
          days: 7,
          timeZone: 'UTC',
        },
      }),
    ),
  ).toBe(false);
});
