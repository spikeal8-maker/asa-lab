import type { AdminDashboardPeriod } from '@asa-lab/contracts';
import {
  call,
  type AdminErrorTrend,
  type AdminProductDashboard,
  type AdminScope,
} from './admin-api';

export const adminDashboardApi = {
  dashboard: (
    input: { readonly scope: Pick<AdminScope, 'kind' | 'id'> } & AdminDashboardPeriod,
  ) => {
    const query = new URLSearchParams({ scopeKind: input.scope.kind, range: input.range });
    if (input.scope.id !== null) query.set('scopeId', input.scope.id);
    if (input.range === 'custom') {
      query.set('fromDate', input.fromDate);
      query.set('toDate', input.toDate);
    }
    return call<AdminProductDashboard>(`/api/admin/v1/dashboard?${query.toString()}`);
  },
  errorTrend: (input: { from: string; to: string; bucketSeconds: number }, signal: AbortSignal) => {
    const query = new URLSearchParams({
      from: input.from,
      to: input.to,
      bucketSeconds: String(input.bucketSeconds),
    });
    return call<AdminErrorTrend>(`/api/admin/v1/logs/trend?${query.toString()}`, { signal });
  },
};
