import { useCallback, useEffect, useRef, useState } from 'react';
import type { call as apiCall } from '../api-call';

export interface AiHistoryThread {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly matchPreview?: string;
}

interface Cursor {
  readonly at: string;
  readonly id: string;
}

interface Page {
  readonly items: readonly AiHistoryThread[];
  readonly nextCursor?: Cursor | null;
}

function historyPath(query: string, archived: boolean, cursor?: Cursor): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (archived) params.set('archived', 'true');
  if (cursor) {
    params.set('beforeAt', cursor.at);
    params.set('beforeId', cursor.id);
  }
  return '/api/ai/threads' + (params.size ? '?' + params.toString() : '');
}

/** List requests have their own lifetime. Typing, filtering or refreshing the
 * list must never change the selected conversation or its unsent draft. */
export function useAiThreadHistory(call: typeof apiCall) {
  const [threads, setThreads] = useState<readonly AiHistoryThread[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [search, setSearchValue] = useState('');
  const [archived, setArchivedValue] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const criteria = useRef({ query: '', archived: false });
  const generation = useRef(0);
  const moreBusy = useRef(false);
  const cursorRef = useRef<Cursor | null>(null);
  const request = useRef<AbortController | null>(null);

  const invalidate = useCallback((): number => {
    request.current?.abort();
    moreBusy.current = false;
    cursorRef.current = null;
    setNextCursor(null);
    setLoadingMore(false);
    return ++generation.current;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const version = invalidate();
    const filter = criteria.current;
    const controller = new AbortController();
    request.current = controller;
    setThreads([]);
    setLoading(true);
    setError(null);
    try {
      const result = await call<Page>(historyPath(filter.query, filter.archived), {
        signal: controller.signal,
      });
      if (version !== generation.current) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setThreads(result.data.items);
      cursorRef.current = result.data.nextCursor ?? null;
      setNextCursor(cursorRef.current);
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [call, invalidate]);

  function setSearch(value: string): void {
    if (value === criteria.current.query) return;
    criteria.current = { ...criteria.current, query: value.slice(0, 200) };
    invalidate();
    setThreads([]);
    setLoading(true);
    setSearchValue(criteria.current.query);
  }

  function setArchived(value: boolean): void {
    if (value === criteria.current.archived) return;
    criteria.current = { ...criteria.current, archived: value };
    invalidate();
    setThreads([]);
    setLoading(true);
    setArchivedValue(value);
  }

  useEffect(() => {
    // Invalidate synchronously in the input handlers; even a response arriving
    // during this debounce interval already belongs to the previous query.
    const timer = window.setTimeout(() => void refresh(), search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [archived, refresh, search]);

  useEffect(
    () => () => {
      generation.current += 1;
      request.current?.abort();
    },
    [call],
  );

  async function loadMore(): Promise<void> {
    const cursor = cursorRef.current;
    if (!cursor || moreBusy.current) return;
    moreBusy.current = true;
    setLoadingMore(true);
    const version = generation.current;
    const filter = criteria.current;
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await call<Page>(historyPath(filter.query, filter.archived, cursor), {
        signal: controller.signal,
      });
      if (version !== generation.current) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setThreads((previous) => {
        const ids = new Set(previous.map((thread) => thread.id));
        return [...previous, ...result.data.items.filter((thread) => !ids.has(thread.id))];
      });
      cursorRef.current = result.data.nextCursor ?? null;
      setNextCursor(cursorRef.current);
      setError(null);
    } finally {
      if (version === generation.current) {
        moreBusy.current = false;
        setLoadingMore(false);
      }
    }
  }

  return {
    threads,
    nextCursor,
    search,
    setSearch,
    archived,
    setArchived,
    loading,
    loadingMore,
    error,
    refresh,
    loadMore,
  };
}
