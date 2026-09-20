import { describe, expect, it } from 'vitest';
import {
  advanceArduinoTimedWaveform,
  arduinoWaveformEdgeMicroseconds,
  arduinoWaveformLevel,
  arduinoWaveformLevelAt,
  arduinoWaveformNextDueMicroseconds,
  createArduinoTimedWaveform,
  isArduinoTimedWaveformState,
} from '../domain/arduino-waveform-runtime.js';

describe('canonical Arduino timed waveform math', () => {
  it('generates exact 1000 Hz 50% duty HIGH/LOW edges', () => {
    let state = createArduinoTimedWaveform(100, 1000);
    expect([0, 1, 2, 3, 4].map((index) => arduinoWaveformEdgeMicroseconds(state, index))).toEqual([
      100, 600, 1100, 1600, 2100,
    ]);
    expect(arduinoWaveformLevel(state)).toBe(1);
    expect(arduinoWaveformNextDueMicroseconds(state)).toBe(600);

    state = advanceArduinoTimedWaveform(state, 600).state!;
    expect(arduinoWaveformLevel(state)).toBe(0);
    expect(arduinoWaveformNextDueMicroseconds(state)).toBe(1100);
    state = advanceArduinoTimedWaveform(state, 1100).state!;
    expect(arduinoWaveformLevel(state)).toBe(1);
  });

  it('derives 440 Hz integer edges from the anchor without cumulative drift', () => {
    const state = createArduinoTimedWaveform(0, 440);
    expect([1, 2, 3, 4, 5].map((index) => arduinoWaveformEdgeMicroseconds(state, index))).toEqual([
      1136, 2273, 3409, 4545, 5682,
    ]);
    expect(arduinoWaveformEdgeMicroseconds(state, 880)).toBe(1_000_000);
    expect(arduinoWaveformEdgeMicroseconds(state, 880_000)).toBe(1_000_000_000);
    expect(arduinoWaveformLevelAt(state, 1135)).toBe(1);
    expect(arduinoWaveformLevelAt(state, 1136)).toBe(0);
    expect(arduinoWaveformLevelAt(state, 2273)).toBe(1);
  });

  it('ends at the exact canonical duration and forces LOW', () => {
    const state = createArduinoTimedWaveform(10, 1000, 1260);
    expect(arduinoWaveformNextDueMicroseconds(state)).toBe(510);
    const atEnd = advanceArduinoTimedWaveform(state, 1260);
    expect(atEnd.state).toBeNull();
    expect(arduinoWaveformLevelAt(state, 1260)).toBe(0);
  });

  it('round-trips canonical waveform state through JSON', () => {
    const original = advanceArduinoTimedWaveform(
      createArduinoTimedWaveform(123, 440, 10_123),
      2396,
    ).state!;
    const restored = JSON.parse(JSON.stringify(original));
    expect(isArduinoTimedWaveformState(restored)).toBe(true);
    expect(restored).toEqual(original);
    expect(arduinoWaveformNextDueMicroseconds(restored)).toBe(
      arduinoWaveformNextDueMicroseconds(original),
    );
  });
});
