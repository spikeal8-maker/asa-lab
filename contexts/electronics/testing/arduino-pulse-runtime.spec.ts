import { describe, expect, it } from 'vitest';
import {
  advanceArduinoPulseWait,
  beginArduinoPulseWait,
  isArduinoPulseWaitState,
} from '../domain/arduino-pulse-runtime.js';

describe('Arduino pulseIn canonical wait state machine', () => {
  it('measures a HIGH pulse by canonical edge timestamps', () => {
    const started = beginArduinoPulseWait('d2', true, 100, 0, 100, false);
    expect(started.status).toBe('waiting');
    if (started.status !== 'waiting') return;

    const rising = advanceArduinoPulseWait(started.state, 10, true);
    expect(rising.status).toBe('waiting');
    if (rising.status !== 'waiting') return;

    const falling = advanceArduinoPulseWait(rising.state, 35, false);
    expect(falling).toEqual({ status: 'done', durationMicroseconds: 25 });
  });

  it('measures a LOW pulse by canonical edge timestamps', () => {
    const started = beginArduinoPulseWait('d2', false, 100, 0, 100, false);
    expect(started.status).toBe('waiting');
    if (started.status !== 'waiting') return;
    const lowStarted = advanceArduinoPulseWait(started.state, 7, true);
    expect(lowStarted.status).toBe('waiting');
    if (lowStarted.status !== 'waiting') return;
    const lowEnded = advanceArduinoPulseWait(lowStarted.state, 25, false);
    expect(lowEnded).toEqual({ status: 'done', durationMicroseconds: 18 });
  });

  it('skips an already-active target pulse before measuring the next pulse', () => {
    const started = beginArduinoPulseWait('d2', true, 100, 0, 100, true);
    expect(started.status).toBe('waiting');
    if (started.status !== 'waiting') return;

    const previousEnded = advanceArduinoPulseWait(started.state, 5, false);
    expect(previousEnded.status).toBe('waiting');
    if (previousEnded.status !== 'waiting') return;
    expect(previousEnded.state.phase).toBe('wait-pulse-start');

    const nextStarted = advanceArduinoPulseWait(previousEnded.state, 12, true);
    expect(nextStarted.status).toBe('waiting');
    if (nextStarted.status !== 'waiting') return;

    const nextEnded = advanceArduinoPulseWait(nextStarted.state, 28, false);
    expect(nextEnded).toEqual({ status: 'done', durationMicroseconds: 16 });
  });

  it('returns zero when the canonical timeout expires', () => {
    const started = beginArduinoPulseWait('d2', true, 20, 0, 20, false);
    expect(started.status).toBe('waiting');
    if (started.status !== 'waiting') return;
    expect(advanceArduinoPulseWait(started.state, 20, false)).toEqual({
      status: 'done',
      durationMicroseconds: 0,
    });
  });
  it('rejects malformed persisted waits outside the unsigned-long timeout contract', () => {
    const started = beginArduinoPulseWait('d2', true, 100, 0, 100, false);
    expect(started.status).toBe('waiting');
    if (started.status !== 'waiting') return;

    expect(isArduinoPulseWaitState({ ...started.state, timeoutMicroseconds: 4_294_967_296 })).toBe(
      false,
    );
    expect(isArduinoPulseWaitState({ ...started.state, deadlineMicroseconds: 101 })).toBe(false);
  });

  it('accepts a JSON-round-tripped wait continuation', () => {
    const started = beginArduinoPulseWait('d2', true, 100, 0, 100, false);
    expect(started.status).toBe('waiting');
    if (started.status !== 'waiting') return;

    const measuring = advanceArduinoPulseWait(started.state, 10, true);
    expect(measuring.status).toBe('waiting');
    if (measuring.status !== 'waiting') return;

    const restored = JSON.parse(JSON.stringify(measuring.state));
    expect(isArduinoPulseWaitState(restored)).toBe(true);
    expect(advanceArduinoPulseWait(restored, 30, false)).toEqual({
      status: 'done',
      durationMicroseconds: 20,
    });
  });
});
