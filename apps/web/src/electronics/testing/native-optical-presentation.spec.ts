// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  NativeOpticalPresentation,
  type NativeOpticalObservation,
} from '../native-optical-presentation';
function observation(token = 'one'): NativeOpticalObservation {
  return {
    result: { components: [] } as unknown as NativeOpticalObservation['result'],
    frame: {
      token,
      atMicroseconds: 1000,
      brightness: new Map([
        ['red', 70],
        ['green', 0],
      ]),
      arduinoLStates: new Map([['uno', true]]),
    },
    ledAssets: new Map([
      ['red', {}],
      ['green', {}],
    ]) as unknown as NativeOpticalObservation['ledAssets'],
  };
}
describe('mounted-owner native optical projection port', () => {
  it('isolates scalar clock subscribers from optical snapshots and releases them on unmount', () => {
    const port = new NativeOpticalPresentation(),
      optical = vi.fn(),
      clock = vi.fn();
    port.subscribe(optical);
    const dispose = port.subscribeClock(clock);
    const snapshot = port.getSnapshot();
    port.setClock(1_000_000);
    port.setClock(1_000_000);
    expect(port.readClock()).toBe(1_000_000);
    expect(port.getSnapshot()).toBe(snapshot);
    expect(optical).not.toHaveBeenCalled();
    expect(clock).toHaveBeenCalledTimes(1);
    dispose();
    port.setClock(0);
    expect(clock).toHaveBeenCalledTimes(1);
  });

  it('publishes proposed leaves without exposing an unacknowledged canonical result', () => {
    const port = new NativeOpticalPresentation(),
      next = observation(),
      notify = vi.fn();
    const unsubscribe = port.subscribe(notify);
    port.setObservation(next, true);
    expect(port.getSnapshot().observation).toBe(next);
    expect(port.getSnapshot().committed).toBeNull();
    port.commit(next);
    expect(port.getSnapshot().committed).toBe(next);
    expect(notify).toHaveBeenCalledTimes(2);
    unsubscribe();
    port.setObservation(null);
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it('waits for every native LED and Arduino layout in the identical vector snapshot', () => {
    const port = new NativeOpticalPresentation(),
      ack = vi.fn();
    port.setBarrier(ack);
    port.setObservation(observation(), true);
    const snapshot = port.getSnapshot();
    port.rendered('red', snapshot);
    port.afterLayout(snapshot);
    expect(ack).not.toHaveBeenCalled();
    port.rendered('green', snapshot);
    port.afterLayout(snapshot);
    expect(ack).not.toHaveBeenCalled();
    port.rendered('uno', snapshot);
    port.afterLayout(snapshot);
    expect(ack).toHaveBeenCalledWith(snapshot);
  });
  it('rejects stale snapshots, disposed render receipts and stale proposed commits', () => {
    const port = new NativeOpticalPresentation(),
      ack = vi.fn(),
      old = observation();
    port.setBarrier(ack);
    port.setObservation(old, true);
    const before = port.getSnapshot();
    const cleanup = port.rendered('red', before);
    port.rendered('green', before);
    port.rendered('uno', before);
    cleanup();
    port.afterLayout(before);
    expect(ack).not.toHaveBeenCalled();
    port.setObservation(observation('new'), true);
    port.rendered('red', before);
    port.afterLayout(before);
    port.commit(old);
    expect(ack).not.toHaveBeenCalled();
    expect(port.getSnapshot().committed).toBeNull();
  });
  it('keeps the exact previous committed result through rollback and unmount ownership cleanup', () => {
    const port = new NativeOpticalPresentation(),
      old = observation(),
      next = observation('next'),
      ack = vi.fn();
    port.setObservation(old);
    port.setRollback(old.ledAssets);
    port.setObservation(next, true);
    expect(port.getSnapshot().committed).toBe(old);
    port.setObservation(old);
    port.setRollback(null);
    expect(port.getSnapshot().observation).toBe(old);
    port.setBarrier(ack);
    port.setBarrier(null);
    const snapshot = port.getSnapshot();
    for (const id of ['red', 'green', 'uno']) port.rendered(id, snapshot);
    port.afterLayout(snapshot);
    expect(ack).not.toHaveBeenCalled();
  });
});

describe('mounted vector render witness', () => {
  function mounted(token = 'one') {
    const previous = observation(token);
    const active = vi.fn(() => true);
    const lease = { isCurrent: () => true, isActive: active };
    const ledAssets = new Map([
      ['red', lease],
      ['green', lease],
    ]) as unknown as NativeOpticalObservation['ledAssets'];
    return { value: { ...previous, ledAssets }, active };
  }

  it('requires a post-RAF task and the same active mounted vector', () => {
    vi.useFakeTimers();
    try {
      const port = new NativeOpticalPresentation();
      const { value, active } = mounted();
      port.setObservation(value, true);
      port.commit(value);
      port.witnessAfterAnimationFrame();
      expect(port.hasRenderWitness()).toBe(false);
      vi.advanceTimersByTime(0);
      expect(port.hasRenderWitness()).toBe(true);
      port.setObservation({ ...value, frame: { ...value.frame, atMicroseconds: 2000 } });
      expect(port.hasRenderWitness()).toBe(true);
      active.mockReturnValue(false);
      expect(port.hasRenderWitness()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['hidden', 'replacement', 'unmount', 'stop'] as const)(
    'retires the pending witness across %s',
    (change) => {
      vi.useFakeTimers();
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      try {
        const port = new NativeOpticalPresentation();
        const { value } = mounted();
        port.setObservation(value, true);
        port.commit(value);
        port.witnessAfterAnimationFrame();
        port.witnessAfterAnimationFrame();
        expect(vi.getTimerCount()).toBe(1);
        if (change === 'hidden') visibility.mockReturnValue('hidden');
        if (change === 'replacement') {
          const next = mounted('new').value;
          port.setObservation(next, true);
          port.commit(next);
        }
        if (change === 'unmount') port.setBarrier(null);
        if (change === 'stop') port.setObservation(null);
        vi.advanceTimersByTime(0);
        visibility.mockReturnValue('visible');
        expect(port.hasRenderWitness()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        visibility.mockRestore();
        vi.useRealTimers();
      }
    },
  );
  it('runs one queued retry after other render tasks and cancels it on reset', () => {
    vi.useFakeTimers();
    try {
      const port = new NativeOpticalPresentation();
      const { value } = mounted();
      const retry = vi.fn();
      port.setObservation(value, true);
      port.commit(value);
      port.witnessAfterAnimationFrame(retry, () => true);
      vi.advanceTimersByTime(0);
      expect(port.hasRenderWitness()).toBe(true);
      expect(retry).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      port.setObservation(null);
      vi.runOnlyPendingTimers();
      expect(retry).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
