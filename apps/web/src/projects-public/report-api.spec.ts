import { beforeEach, expect, it, vi } from 'vitest';
import { call } from '../api-call';
import { publicProjectsApi } from './api';
vi.mock('../api-call', () => ({ call: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it('posts only the report payload through the shared authenticated adapter', async () => {
  const signal = new AbortController().signal;
  const payload = { revisionId: 'revision', reason: 'spam', comment: '<script>private</script>' };
  vi.mocked(call).mockResolvedValue({ ok: true, status: 200, data: null });
  await publicProjectsApi.report('publication/id', payload, 'same-key', signal);
  expect(call).toHaveBeenCalledWith('/api/public-projects/publication%2Fid/reports', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'same-key' },
    body: JSON.stringify(payload),
    signal,
  });
});
