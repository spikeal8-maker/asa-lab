import type { AiUsageOverview } from '@asa-lab/contracts';

export function usageOverviewFixture(overrides: Partial<AiUsageOverview> = {}): AiUsageOverview {
  return {
    schemaVersion: 1,
    period: {
      from: '2026-10-21T00:00:00.000000Z',
      to: '2026-10-27T12:30:00.000001Z',
      timeZone: 'UTC',
      days: 7,
    },
    generatedAt: '2026-10-27T12:30:00.000001Z',
    requests: 9,
    inputTokens: { known: '4500', knownOperations: 9, unknownOperations: 0 },
    outputTokens: { known: '450', knownOperations: 9, unknownOperations: 0 },
    daily: [1, 0, 2, 1, 3, 0, 2].map((requests, index) => ({
      date: `2026-10-${21 + index}`,
      requests,
    })),
    state: 'complete',
    ...overrides,
  };
}
