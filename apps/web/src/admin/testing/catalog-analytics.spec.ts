import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CatalogAnalytics, chartTickIndices } from '../CatalogAnalytics';
import type { AdminCatalogPage } from '../admin-api';
const base: NonNullable<AdminCatalogPage['analytics']> = {
  accounts: 2,
  students: 3,
  linkedRecords: 1,
  ageUnknown: 4,
  emailAbsent: 3,
  sourceUnknown: 5,
  activeObserved: 1,
  aiRequests: 1,
  aiTokenCovered: 1,
  periodDays: 30,
  roles: {},
  referrers: {},
  aiInputTokens: '90071992547409931234567890',
  aiOutputTokens: '90071992547409931234567891',
};
function render(value: NonNullable<AdminCatalogPage['analytics']>) {
  return renderToStaticMarkup(createElement(CatalogAnalytics, { value }));
}
describe('CRM factual analytics charts', () => {
  it('uses ten existing readable date ticks including both edges for 30 and 90 days', () => {
    for (const length of [30, 90]) {
      const ticks = chartTickIndices(length);
      expect(ticks).toHaveLength(10);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBe(length - 1);
      expect(new Set(ticks).size).toBe(10);
    }
    expect(chartTickIndices(0)).toEqual([]);
    expect(chartTickIndices(1)).toEqual([0]);
  });
  it('renders both independent series for seven days including zero events and exact keyboard values', () => {
    const daily = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      registrations: i + 1,
      events: 0,
    }));
    const html = render({ ...base, periodDays: 7, daily });
    expect(html.match(/<polyline/g)).toHaveLength(2);
    expect(html).toContain('aria-label="2026-10-07 UTC: 7"');
    expect(html).toContain('aria-label="2026-10-07 UTC: 0"');
    expect(html.match(/<circle[^>]*tabindex="0"/g)).toHaveLength(14);
    expect(html).toContain('За эти дни сохранённые значения равны нулю');
    expect(html).toContain('Точные значения по дням');
    expect(html).not.toContain('менее 10 точек');
  });
  it('keeps large token decimals exact and missing history explicitly unknown', () => {
    const html = render(base);
    expect(html).toContain(base.aiInputTokens);
    expect(html).toContain(base.aiOutputTokens);
    expect(html.match(/История по дням недоступна/g)).toHaveLength(2);
    expect(html).toContain('это не число уникальных людей');
    expect(html).toContain('Сведения о сборе кампаний недоступны в этой версии сервера');
    expect(html).toContain('а не доказанный источник регистрации');
  });
  it('separates actual registration methods from literal browser campaign claims and retention coverage', () => {
    const html = render({
      ...base,
      registrationMethods: { password: 1 },
      acquisition: {
        status: 'collecting_current_document',
        retentionDays: 90,
        observations: 2,
        observedRecords: 1,
        unknownRecords: 4,
        sources: { password: 1 },
        mediums: { email: 1 },
        campaigns: { autumn_2026: 1 },
      },
    });
    expect(html).toContain('Способы зафиксированных регистраций Account за период');
    expect(html).toContain('<dt>Пароль</dt>');
    expect(html).toContain('<dt>password</dt>');
    expect(html).toContain('<dt>email</dt>');
    expect(html).toContain('Хранение: 90 дней');
    expect(html).toContain('Старые и отсутствующие наблюдения');
    expect(html).toContain('без доступных наблюдений: 4');
  });
});
