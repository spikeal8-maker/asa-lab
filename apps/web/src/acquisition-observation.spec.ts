import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcquisitionObservation, campaignObservation } from './acquisition-observation';
const actor = {
  kind: 'account' as const,
  accountId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
};
const claim = { source: 'school', medium: 'email', campaign: 'autumn-2026' };
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('optional campaign observation', () => {
  it('extracts only bounded controlled UTM slugs and drops unrelated secrets', () => {
    expect(
      campaignObservation(
        '?utm_source=School&utm_medium=email&utm_campaign=autumn-2026&token=secret&redirect=https://private.test',
      ),
    ).toEqual(claim);
    expect(campaignObservation('?token=secret')).toBeNull();
    for (const query of [
      '?utm_source=mail@example.test',
      '?utm_source=one&utm_source=two',
      '?utm_source=a%2Fb',
      '?utm_source=' + 'a'.repeat(65),
      '?' + 'x'.repeat(4097),
    ])
      expect(campaignObservation(query)).toBeNull();
  });
  it('never stores anonymous claims or reattributes a document across contexts', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response('{}', { status: 404 }));
    const queue = new AcquisitionObservation(claim, transport);
    queue.update(null);
    expect(transport).not.toHaveBeenCalled();
    queue.update(actor);
    await vi.waitFor(() => expect(queue.quality.rejected).toBe(1));
    queue.update({ ...actor, workspaceId: actor.accountId });
    queue.update(actor);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(transport.mock.calls[0]![1]!.body))).toMatchObject({
      actorExpectation: actor,
      ...claim,
    });
  });
  it('acknowledges only an exact persisted receipt', async () => {
    const transport = vi.fn<typeof fetch>(async (_path, init) => {
      const { eventId } = JSON.parse(String(init!.body));
      return new Response(
        JSON.stringify({
          accepted: true,
          state: 'persisted',
          schemaVersion: 2,
          receivedAt: new Date().toISOString(),
          eventId,
          receiptId: eventId,
          operation: 'acquisition.observed',
          persistedAt: new Date().toISOString(),
        }),
        { status: 200 },
      );
    });
    const queue = new AcquisitionObservation(claim, transport);
    queue.update(actor);
    await vi.waitFor(() => expect(queue.quality.acknowledged).toBe(1));
    queue.update(actor);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('bounds retry lifetime and leaves canonical visits independent', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>(async () => new Response('{}', { status: 503 }));
    const queue = new AcquisitionObservation(claim, transport);
    queue.update(actor);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(queue.quality.expired).toBe(1);
    expect(transport.mock.calls.length).toBeLessThanOrEqual(8);
    expect(transport.mock.calls.every(([url]) => url === '/api/analytics/v2/acquisition')).toBe(
      true,
    );
    queue.stop();
  });
  it('cancels pending retries on loss of authenticated context', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>(async () => new Response('{}', { status: 503 }));
    const queue = new AcquisitionObservation(claim, transport);
    queue.update(actor);
    await vi.advanceTimersByTimeAsync(1);
    queue.update(null);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
