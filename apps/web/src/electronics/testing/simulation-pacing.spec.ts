import { describe, expect, it } from 'vitest';
import { SimulationPacing } from '../simulation-pacing';

describe('session host pacing adapter', () => {
  it.each([0.1, 0.5, 1, 2, 10])(
    'scales demand at rate %s and reanchors without old wall catch-up',
    (rate) => {
      const pace = new SimulationPacing();
      pace.request(rate);
      pace.reanchor(5000, 100000);
      expect(pace.horizon(110000, 5000)).toBe(5000 + Math.floor(10000 * rate));
      pace.request(0);
      pace.settlePause();
      expect(pace.horizon(999999999, 5000)).toBeNull();
      expect(pace.read().lastNonZero).toBe(rate);
      pace.request(rate);
      pace.reanchor(7000, 999999999);
      expect(pace.horizon(999999999, 7000)).toBe(7000);
      expect(pace.horizon(1000000999, 7000)).toBe(7000 + 1000 * rate);
    },
  );
  it('preserves untouched default routing and rejects nonfinite or unsupported rates', () => {
    const pace = new SimulationPacing();
    expect(pace.explicit).toBe(false);
    for (const rate of [NaN, Infinity, -1, 0.15, 11]) expect(pace.request(rate)).toBe(false);
    expect(pace.read()).toEqual({ rate: 1, lastNonZero: 1, phase: 'running' });
  });
  it('never backdates demand when an old accepted response is ahead of the new slow anchor', () => {
    const pace = new SimulationPacing();
    pace.request(0.1);
    pace.reanchor(1000, 10000);
    expect(pace.horizon(11000, 25000)).toBe(25000);
    pace.reanchor(25000, 11000);
    pace.request(10);
    expect(pace.horizon(12000, 25000)).toBe(35000);
  });
});
