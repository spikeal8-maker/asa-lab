import { EventEmitter } from 'node:events';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { describe, it, expect, vi } from 'vitest';
import { observeHttpTerminal } from './http-observation';
import { createRuntimeMetrics } from '@asa-lab/observability';

function fixture() {
  const incoming = new EventEmitter();
  const outgoing = Object.assign(new EventEmitter(), { writableFinished: false });
  const callback = vi.fn();
  const finish = observeHttpTerminal(
    { raw: incoming } as FastifyRequest,
    { raw: outgoing } as FastifyReply,
    callback,
  );
  return { incoming, outgoing, callback, finish };
}
describe('HTTP terminal observation', () => {
  it.each(['request_aborted', 'connection_closed'] as const)(
    'settles an already ended stream as %s',
    (outcome) => {
      const incoming = Object.assign(new EventEmitter(), {
        aborted: outcome === 'request_aborted',
      });
      const outgoing = Object.assign(new EventEmitter(), {
        destroyed: true,
        writableFinished: false,
      });
      const callback = vi.fn();
      const finish = observeHttpTerminal(
        { raw: incoming } as FastifyRequest,
        { raw: outgoing } as FastifyReply,
        callback,
      );
      expect(callback.mock.calls).toEqual([[outcome]]);
      expect(finish('response')).toBe(false);
      expect(incoming.listenerCount('aborted')).toBe(0);
      expect(outgoing.listenerCount('close')).toBe(0);
    },
  );
  it.each(['request_aborted', 'connection_closed'] as const)(
    'records %s once without inventing a response',
    (outcome) => {
      const f = fixture();
      if (outcome === 'request_aborted') f.incoming.emit('aborted');
      else f.outgoing.emit('close');
      f.incoming.emit('aborted');
      f.outgoing.emit('close');
      expect(f.finish('response')).toBe(false);
      expect(f.callback.mock.calls).toEqual([[outcome]]);
      expect(f.incoming.listenerCount('aborted')).toBe(0);
      expect(f.outgoing.listenerCount('close')).toBe(0);
    },
  );
  it('does not classify ordinary close after finish as a disconnect', () => {
    const f = fixture();
    f.outgoing.writableFinished = true;
    f.outgoing.emit('close');
    expect(f.callback).not.toHaveBeenCalled();
    expect(f.finish('response')).toBe(true);
    f.outgoing.emit('close');
    expect(f.callback.mock.calls).toEqual([['response']]);
  });
  it('isolates observer failure and counts cancellation separately from HTTP status', () => {
    const f = fixture();
    f.callback.mockImplementation(() => {
      throw new Error('observer');
    });
    expect(() => f.outgoing.emit('close')).not.toThrow();
    const metrics = createRuntimeMetrics();
    try {
      metrics.requestStarted();
      metrics.requestFinished(undefined, 10);
      expect(metrics.snapshot(null).requests).toMatchObject({
        total: 1,
        inFlight: 0,
        byStatusClass: { aborted: 1 },
      });
    } finally {
      metrics.stop();
    }
  });
});
