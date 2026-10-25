// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { AdminDashboard, chartLabelIndexes, chartCountAxis } from '../AdminDashboard';
import {
  adminApi,
  type AdminScope,
  type AdminApiResult,
  type AdminProductDashboard,
} from '../admin-api';
import { adminSessionIdentity, adminProfileMatchesSession } from '../admin-session-access';
import type { SessionPayload } from '../../api';
import { adminDashboardFixture } from './admin-dashboard.fixture';

const scope: AdminScope = {
  kind: 'platform',
  id: null,
  title: 'ASA Lab',
  role: 'platform_admin',
  permissions: ['administration.open'],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const deferred = () => {
  let resolve!: (value: AdminApiResult<AdminProductDashboard>) => void;
  const promise = new Promise<AdminApiResult<AdminProductDashboard>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const success = (marker = 8) => ({
  ok: true as const,
  status: 200,
  data: adminDashboardFixture('24h', marker),
});
async function show(selected = scope, denied = vi.fn()) {
  await act(async () =>
    root.render(createElement(AdminDashboard, { scope: selected, onAccessDenied: denied })),
  );
}
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll('button')].find((button) => button.textContent === text)!.click(),
  );
}

describe('admin overview lifecycle', () => {
  it('uses distinct integer count ticks for small and large values', () => {
    for (const value of [0, 1, 2, 5, 101, 10000]) {
      const axis = chartCountAxis(value);
      expect(new Set(axis.ticks).size).toBe(axis.ticks.length);
      expect(axis.ticks.every(Number.isInteger)).toBe(true);
      expect(axis.maximum).toBeGreaterThanOrEqual(value);
      expect(axis.ticks[0]).toBe(0);
    }
  });
  it('shows >=10 distinct time labels when available, never inventing points', () => {
    for (const length of [0, 1, 2, 10, 12, 24]) {
      const indexes = chartLabelIndexes(length);
      expect(new Set(indexes).size).toBe(indexes.length);
      expect(indexes.length).toBe(Math.min(length, 12));
      if (length >= 10) expect(indexes.length).toBeGreaterThanOrEqual(10);
      if (length) expect(indexes.at(-1)).toBe(length - 1);
    }
  });
  it('retains mounted charts on matching refresh, reports refreshing/error, and splits learning tools from games with all colors', async () => {
    const pending = deferred();
    vi.spyOn(adminApi, 'dashboard')
      .mockResolvedValueOnce(success())
      .mockReturnValueOnce(pending.promise);
    await show();
    const chart = host.querySelector('.admin-chart-card');
    await click('Обновить');
    expect(host.querySelector('.admin-chart-card')).toBe(chart);
    expect(host.textContent).toContain('Пока показаны предыдущие данные');
    await act(async () =>
      pending.resolve({ ok: false, status: 503, error: { code: 'offline', message: 'offline' } }),
    );
    expect(host.querySelector('.admin-chart-card')).toBe(chart);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Показаны предыдущие данные',
    );
    const cards = [...host.querySelectorAll('.admin-chart-card')];
    const learning = cards.find((card) =>
      card.textContent?.includes('Учебные инструменты — запуски'),
    )!;
    const games = cards.find((card) => card.textContent?.includes('Игры — запуски'))!;
    expect(learning.textContent).toContain('Scratch');
    expect(learning.textContent).not.toContain('Шахматы');
    expect(games.textContent).toContain('Шашки');
    expect(games.textContent).not.toContain('Электроника');
    expect(
      [...host.querySelectorAll('svg path')].every((path) =>
        /^#[0-9a-f]{6}$/.test(path.getAttribute('stroke') ?? ''),
      ),
    ).toBe(true);
  });
  it('immediately removes stale scope and range data and rejects their late response', async () => {
    const old = deferred(),
      fresh = deferred();
    vi.spyOn(adminApi, 'dashboard')
      .mockResolvedValueOnce(success())
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    await show();
    await click('Обновить');
    await show({ ...scope, kind: 'organization', id: 'school', title: 'Школа' });
    expect(host.querySelector('.admin-chart-card')).toBeNull();
    await act(async () => old.resolve(success(999)));
    expect(host.querySelector('.admin-chart-card')).toBeNull();
    await act(async () => fresh.resolve(success(42)));
    expect(host.querySelector('.admin-chart-card')).not.toBeNull();
    vi.mocked(adminApi.dashboard).mockReturnValueOnce(new Promise(() => undefined));
    await click('7 дней');
    expect(host.querySelector('.admin-chart-card')).toBeNull();
    expect(host.textContent).toContain('Собираем реальные показатели');
  });
  it.each([401, 403])('clears chart data on %s even during refresh', async (status) => {
    const denied = vi.fn();
    vi.spyOn(adminApi, 'dashboard')
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce({ ok: false, status, error: { code: 'denied', message: 'denied' } });
    await show(scope, denied);
    await click('Обновить');
    expect(denied).toHaveBeenCalledOnce();
    expect(host.querySelector('.admin-chart-card')).toBeNull();
  });
  it('binds grants to canonical account/workspace/verification context', () => {
    const session = {
      authenticated: true,
      user: { id: 'account' },
      account: { id: 'account' },
      activeWorkspace: { workspaceId: 'workspace', kind: 'personal' },
      capabilities: [{ capability: 'platform_admin', state: 'verified' }],
      workspaces: [],
      verification: undefined,
    } as unknown as SessionPayload;
    const key = adminSessionIdentity(session);
    expect(
      adminSessionIdentity({
        ...session,
        activeWorkspace: { workspaceId: 'other', kind: 'personal' },
      }),
    ).not.toBe(key);
    expect(
      adminSessionIdentity({ ...session, account: { ...session.account, id: 'other' } }),
    ).not.toBe(key);
    expect(
      adminSessionIdentity({
        ...session,
        verification: {
          required: true,
          policyEnabled: true,
          reason: 'verification_required',
          dueAt: null,
          verifiedProvider: null,
          providers: [],
        },
      }),
    ).not.toBe(key);
    expect(
      adminProfileMatchesSession(
        { accountId: 'other', activeWorkspaceId: 'workspace' } as never,
        session,
      ),
    ).toBe(false);
    expect(
      adminProfileMatchesSession(
        { accountId: 'account', activeWorkspaceId: 'other' } as never,
        session,
      ),
    ).toBe(false);
  });
});
