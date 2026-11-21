import type pg from 'pg';
import type { AiUsageOverview } from '@asa-lab/contracts';
import { expect, it, vi } from 'vitest';
import { AiUsageJournal, AiUsageUnavailable } from './ai-usage-journal';

function fixture(): AiUsageOverview {
  return {
    schemaVersion: 1,
    period: {
      from: '2040-03-06T00:00:00.000000Z',
      to: '2040-03-12T12:34:56.123456Z',
      timeZone: 'UTC',
      days: 7,
    },
    generatedAt: '2040-03-12T12:34:56.123456Z',
    requests: 2,
    inputTokens: { known: '18014398509481982', knownOperations: 2, unknownOperations: 0 },
    outputTokens: { known: null, knownOperations: 0, unknownOperations: 2 },
    daily: Array.from({ length: 7 }, (_, index) => ({
      date: `2040-03-${String(index + 6).padStart(2, '0')}`,
      requests: index === 0 ? 2 : 0,
    })),
    state: 'partial',
  };
}

it('reads one server-timed snapshot without rounding token sums or inventing unknown usage', async () => {
  const expected = fixture();
  const query = vi.fn().mockResolvedValue({ rows: [{ overview: expected }] });
  const journal = new AiUsageJournal({ query } as unknown as pg.Pool);
  expect(await journal.overview('trusted-server-actor')).toEqual(expected);
  expect(query).toHaveBeenCalledExactlyOnceWith('SELECT ai_usage_overview($1) AS overview', [
    'trusted-server-actor',
  ]);
});

it.each([new Error('private database endpoint'), { code: '42883', detail: 'private SQL' }])(
  'turns a failed source into a safe unavailable error instead of empty metrics',
  async (problem) => {
    const query = vi.fn().mockRejectedValue(problem);
    const journal = new AiUsageJournal({ query } as unknown as pg.Pool);
    await expect(journal.overview('actor')).rejects.toEqual(
      new AiUsageUnavailable('AI_USAGE_UNAVAILABLE'),
    );
  },
);

it('retains database authorization denial for the HTTP boundary', async () => {
  const problem = { code: '42501', message: 'AI_ADMIN_DENIED' };
  const query = vi.fn().mockRejectedValue(problem);
  const journal = new AiUsageJournal({ query } as unknown as pg.Pool);
  await expect(journal.overview('actor')).rejects.toBe(problem);
});

it('rejects a missing or numerically unsafe snapshot rather than returning decorative zeros', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ overview: { ...fixture(), requests: 2 ** 53 } }] });
  const journal = new AiUsageJournal({ query } as unknown as pg.Pool);
  await expect(journal.overview('actor')).rejects.toBeInstanceOf(AiUsageUnavailable);
  await expect(journal.overview('actor')).rejects.toBeInstanceOf(AiUsageUnavailable);
});
