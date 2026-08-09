import { describe, expect, it } from 'vitest';
import {
  buttonContactPairs,
  lampState,
  motorMotion,
  ordinaryLedState,
  potentiometerKnobAngle,
  rgbLedColour,
  rgbLedState,
  resistorBandState,
  sevenSegmentState,
  servoAngle,
  spdtConnections,
} from '../production-asset-contracts';

describe('typed Electronics state and animation contracts', () => {
  it('normalises ordinary LED colour, 0-100 brightness and fault state', () => {
    expect(ordinaryLedState('blue', -4)).toEqual({
      colour: 'blue',
      brightness: 0,
      fault: 'none',
    });
    expect(ordinaryLedState('yellow', 101)).toEqual({
      colour: 'yellow',
      brightness: 100,
      fault: 'none',
    });
    expect(ordinaryLedState('red', 55, 'reverse')).toEqual({
      colour: 'red',
      brightness: 55,
      fault: 'reverse',
    });
  });

  it('mixes independent RGB channels for either four-pin common mode', () => {
    expect(rgbLedColour(rgbLedState(100, 50, 0, 'common-anode'))).toBe('rgb(255, 128, 0)');
    expect(rgbLedColour(rgbLedState(0, 100, 100, 'common-cathode'))).toBe('rgb(0, 255, 255)');
  });

  it('drives real seven-segment groups and decimal point masks', () => {
    expect([...sevenSegmentState('8', 100, true).active].sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
      'dp',
      'e',
      'f',
      'g',
    ]);
    expect([...sevenSegmentState('1', 34).active]).toEqual(['b', 'c']);
  });

  it('derives four resistor colour bands from resistance and tolerance', () => {
    expect(resistorBandState(220, 5).bands).toEqual(['red', 'red', 'brown', 'gold']);
    expect(resistorBandState(4_700, 5).bands).toEqual(['yellow', 'violet', 'red', 'gold']);
    expect(resistorBandState(1_000_000, 1).bands).toEqual(['brown', 'black', 'green', 'brown']);
  });

  it('models momentary four-pin button and three-pin SPDT connectivity', () => {
    expect(buttonContactPairs(false)).toHaveLength(2);
    expect(buttonContactPairs(true)).toContainEqual(['SW-A1', 'SW-B1']);
    expect(spdtConnections('left')).toEqual([['common', 'throw-left']]);
    expect(spdtConnections('right')).toEqual([['common', 'throw-right']]);
  });

  it('maps potentiometer, lamp, motor and servo inputs to visible motion state', () => {
    expect(potentiometerKnobAngle(0)).toBe(-135);
    expect(potentiometerKnobAngle(0.5)).toBe(0);
    expect(potentiometerKnobAngle(1)).toBe(135);
    expect([0, 0.3, 0.7, 1].map(lampState)).toEqual(['off', 'dim', 'on', 'max']);
    expect(motorMotion(0, 'clockwise')).toMatchObject({
      direction: 'stopped',
      durationSeconds: null,
    });
    expect(motorMotion(1, 'counterclockwise')).toMatchObject({
      direction: 'counterclockwise',
      durationSeconds: 0.2,
    });
    expect(servoAngle(-20)).toBe(0);
    expect(servoAngle(220)).toBe(180);
  });
});
