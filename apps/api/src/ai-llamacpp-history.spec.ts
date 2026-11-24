import type pg from 'pg';
import { expect, it, vi } from 'vitest';
import { AiTextHistoryStore } from './ai-text-history';

function history(rows: { role: 'user' | 'assistant'; content: string }[]) {
  return new AiTextHistoryStore({ query: vi.fn(async () => ({ rows })) } as unknown as pg.Pool);
}

it('admits long llama.cpp history above the legacy budget using a confirmed byte limit', async () => {
  const answer = 'const value = 1;\n'.repeat(4500) + 'EARLIER_HISTORY_NEEDLE';
  const latest = 'const later = 2;\n'.repeat(4000);
  const store = history([
    { role: 'user', content: 'Original question' },
    { role: 'assistant', content: answer },
    { role: 'user', content: 'Next question' },
    { role: 'assistant', content: latest },
    { role: 'user', content: 'Continue this code' },
  ]);
  const context = await store.generationContext('owner', 'thread', 'request', 188416);
  expect(context[1]?.content).toBe(answer);
  expect(Buffer.byteLength(JSON.stringify(context))).toBeGreaterThan(96000);
  expect(context.at(-1)?.content).toBe('Continue this code');
});

it.each([1, 2, 3, 4, 5, 15, 3000])(
  'never splits Unicode or exceeds the llama.cpp byte budget %s',
  async (budget) => {
    const store = history([
      { role: 'assistant', content: '🙂Привет'.repeat(30000) },
      { role: 'user', content: 'Что дальше🙂' },
    ]);
    const context = await store.generationContext('owner', 'thread', 'request', budget);
    expect(context.reduce((n, item) => n + Buffer.byteLength(item.content), 0)).toBeLessThanOrEqual(
      budget,
    );
    expect(context.every((item) => !item.content.includes('\uFFFD'))).toBe(true);
    if (budget >= Buffer.byteLength('Что дальше🙂'))
      expect(context.at(-1)?.content).toBe('Что дальше🙂');
  },
);

it('keeps the existing latest-answer behavior for every provider without a llama.cpp budget', async () => {
  const answer = 'x'.repeat(150000);
  const store = history([
    { role: 'user', content: 'Before' },
    { role: 'assistant', content: answer },
    { role: 'user', content: 'After' },
  ]);
  const context = await store.generationContext('owner', 'thread', 'request');
  expect(context).toEqual([
    { role: 'assistant', content: answer },
    { role: 'user', content: 'After' },
  ]);
});
