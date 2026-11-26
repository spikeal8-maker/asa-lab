export type AdminDashboardRange =
  'today' | 'yesterday' | '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d' | '1y';

export type AdminDashboardPeriod =
  | { readonly range: AdminDashboardRange }
  | { readonly range: 'custom'; readonly fromDate: string; readonly toDate: string };

const DAY = 86_400_000;
const MOSCOW_OFFSET = 3 * 3_600_000;

export function moscowDateKey(timestamp: number): string {
  return new Date(timestamp + MOSCOW_OFFSET).toISOString().slice(0, 10);
}

function moscowMidnight(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const midnight = Date.parse(`${value}T00:00:00+03:00`);
  return Number.isFinite(midnight) && moscowDateKey(midnight) === value ? midnight : NaN;
}

export function adminDashboardDateBounds(
  fromDate: unknown,
  toDate: unknown,
  now = Date.now(),
): { readonly from: Date; readonly to: Date; readonly bucketSeconds: number } | null {
  const from = moscowMidnight(fromDate);
  const last = moscowMidnight(toDate);
  const days = (last - from) / DAY + 1;
  if (!(days > 0 && days <= 365 && last <= now && from < now)) return null;
  const bucketSeconds = days === 1 ? 3600 : days <= 14 ? 21600 : days <= 90 ? 86400 : 604800;
  return { from: new Date(from), to: new Date(Math.min(now, last + DAY)), bucketSeconds };
}
