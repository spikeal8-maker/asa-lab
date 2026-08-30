import { describe, expect, it } from 'vitest';
import {
  formatIlluminanceLux,
  formatPhotoresistorResistance,
  photoresistorLightCondition,
} from '../photoresistor-presentation';

describe('photoresistor presentation', () => {
  it('uses readable units without false decimal precision', () => {
    expect(formatIlluminanceLux(0)).toBe('0 лк');
    expect(formatIlluminanceLux(0.25)).toBe('0.25 лк');
    expect(formatIlluminanceLux(31.52)).toBe('32 лк');
    expect(formatIlluminanceLux(1_250)).toBe('1.3 тыс. лк');
    expect(formatPhotoresistorResistance(1_000_000)).toBe('1.00 МОм');
    expect(formatPhotoresistorResistance(15_000)).toBe('15.0 кОм');
    expect(formatPhotoresistorResistance(597)).toBe('597 Ом');
  });

  it('describes the environment rather than exposing a bare percentage', () => {
    expect(photoresistorLightCondition(0)).toBe('Темнота');
    expect(photoresistorLightCondition(5)).toBe('Сумерки');
    expect(photoresistorLightCondition(250)).toBe('Освещённое помещение');
    expect(photoresistorLightCondition(2_000)).toBe('Яркий свет');
  });
});
