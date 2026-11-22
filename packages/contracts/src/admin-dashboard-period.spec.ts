import { describe, expect, it } from 'vitest';
import { adminDashboardDateBounds } from './admin-dashboard-period.js';

describe('admin dashboard Moscow date selection', () => {
  const now = Date.parse('2026-11-22T12:34:00Z');
  it('includes the full ending date and clips today at the current time', () => {
    expect(adminDashboardDateBounds('2026-11-20', '2026-11-21', now)).toEqual({
      from: new Date('2026-11-19T21:00:00Z'),
      to: new Date('2026-11-21T21:00:00Z'),
      bucketSeconds: 21600,
    });
    expect(adminDashboardDateBounds('2026-11-22', '2026-11-22', now)).toEqual({
      from: new Date('2026-11-21T21:00:00Z'),
      to: new Date(now),
      bucketSeconds: 3600,
    });
  });
  it('chooses bounded daily and weekly bins', () => {
    expect(adminDashboardDateBounds('2026-09-01', '2026-10-20', now)?.bucketSeconds).toBe(86400);
    expect(adminDashboardDateBounds('2025-12-01', '2026-11-22', now)?.bucketSeconds).toBe(604800);
  });
  it('rejects malformed dates, dates out of order, future dates and a window beyond one year', () => {
    expect(adminDashboardDateBounds('2026-02-30', '2026-03-01', now)).toBeNull();
    expect(adminDashboardDateBounds('2026-11-22', '2026-11-21', now)).toBeNull();
    expect(adminDashboardDateBounds('2026-11-23', '2026-11-23', now)).toBeNull();
    expect(adminDashboardDateBounds('2025-11-22', '2026-11-22', now)).toBeNull();
  });
});
