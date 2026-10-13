import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  journalAccessibleLabel,
  journalGradeLabel,
  journalLevels,
  journalMonthRange,
  journalShiftMonth,
  journalApi,
} from '../../classroom-journal-api';
import { journalDestination } from '../journal-destination';
afterEach(() => vi.unstubAllGlobals());
describe('manual journal grade semantics', () => {
  it('keeps zero distinct from missing and offers exact allowed values', () => {
    expect(journalGradeLabel('five', null)).toBe('Нет оценки');
    expect(journalGradeLabel('five', 0)).toBe('0');
    expect(journalLevels('five')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(journalLevels('three_five')).toEqual([3, 4, 5]);
    expect(journalLevels('hundred')).toHaveLength(101);
    expect(journalLevels('hundred')[100]).toBe(100);
  });
  it('names the order of visual levels accessibly', () => {
    for (const preset of ['smileys', 'symbols'] as const) {
      expect(journalLevels(preset)).toEqual([1, 2, 3, 4, 5]);
      expect(new Set(journalLevels(preset).map((v) => journalGradeLabel(preset, v))).size).toBe(5);
      expect(journalAccessibleLabel(preset, 1)).toContain('уровень 1 из 5');
      expect(journalAccessibleLabel(preset, 5)).toContain('уровень 5 из 5');
    }
  });
  it('keeps lesson calendar dates independent of the device timezone and handles month boundaries', () => {
    expect(journalMonthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(journalMonthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(journalShiftMonth('2026-01', -1)).toBe('2025-12');
    expect(journalShiftMonth('2026-12', 1)).toBe('2027-01');
    expect(journalDestination('#/learning?journalMonth=1999-12&journalColumn=spoof')).toEqual({
      month: '',
      columnId: undefined,
    });
  });
  it('calls distinct learner endpoints and never attempts Account refresh for Seat unauthorized', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Войдите' } }), {
        status: 401,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await journalApi.results('seat', {
      from: '2026-10-01',
      to: '2026-10-31',
      offset: 20,
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      '/api/class-join/journal/results?from=2026-10-01&to=2026-10-31&offset=20',
    );
    fetch.mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    await journalApi.results('account');
    expect(fetch.mock.calls[1][0]).toBe('/api/learning/journal/results?');
  });
});
