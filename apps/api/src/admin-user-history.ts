import { parseCatalogQuery } from './admin-user-catalog.js';

export type HistoryCategory = 'projects' | 'publications' | 'ai';
export interface AdminHistoryItem {
  key: string;
  type: 'project' | 'version' | 'publication' | 'legacy_publication' | 'ai';
  id: string;
  occurredAt: string;
  title?: string | null;
  projectId?: string | null;
  module?: string | null;
  status?: string | null;
  revision?: number | null;
  provider?: string | null;
  model?: string | null;
  requestedModel?: string | null;
  inputTokens?: string | null;
  outputTokens?: string | null;
  errorCode?: string | null;
  durationMs?: string | null;
}
export interface AdminHistoryPage {
  items: AdminHistoryItem[];
  next: string | null;
  asOf: string;
  coverage: 'retained' | 'unavailable_scope';
}
export function parseHistoryQuery(raw: {
  category?: string | undefined;
  limit?: string | undefined;
  cursor?: string | undefined;
  scopeKind?: string | undefined;
  scopeId?: string | undefined;
}) {
  const { category, ...page } = raw;
  if (category !== undefined && !['projects', 'publications', 'ai'].includes(category)) {
    throw Object.assign(new Error('ADMIN_HISTORY_QUERY_INVALID'), { code: '22023' });
  }
  const parsed = parseCatalogQuery(page);
  return {
    category: (category ?? 'projects') as HistoryCategory,
    limit: parsed.limit,
    cursor: parsed.cursor,
  };
}
