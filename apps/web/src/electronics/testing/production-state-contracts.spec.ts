import { describe, expect, it } from 'vitest';
import {
  buttonContactPairs,
  dcMotorRuntimeMarkup,
  dcMotorVisualMotion,
  formatMotorRpm,
  gearmotorDiagnosticBodyBounds,
  gearmotorRpmBodyPoint,
  gearmotorRuntimeMarkup,
  gearmotorVisualPresentation,
  lampState,
  motorMotion,
  multimeterRuntimeMarkup,
  ordinaryLedState,
  potentiometerKnobAngle,
  potentiometerRuntimeMarkup,
  rgbLedColour,
  rgbLedDisplayColour,
  rgbLedState,
  rgbLedVisualOpacity,
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
    expect(rgbLedDisplayColour(rgbLedState(40, 0, 0, 'common-cathode'))).toBe('rgb(255, 0, 0)');
    expect(rgbLedDisplayColour(rgbLedState(40, 20, 0, 'common-cathode'))).toBe('rgb(255, 128, 0)');
    expect(rgbLedVisualOpacity(rgbLedState(0, 0, 0, 'common-cathode'))).toBe(0);
    expect(rgbLedVisualOpacity(rgbLedState(40, 0, 0, 'common-cathode'))).toBe(0.618);
    expect(rgbLedVisualOpacity(rgbLedState(100, 0, 0, 'common-cathode'))).toBe(0.93);
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
    // The knob graphic points down at rotate(0), so the sweep is offset by
    // 180°: 0 aims down-left at terminal-1, 1 aims down-right at terminal-2.
    expect(potentiometerKnobAngle(0)).toBe(45);
    expect(potentiometerKnobAngle(0.5)).toBe(180);
    expect(potentiometerKnobAngle(1)).toBe(315);
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

  it('rotates the two existing owner SVG pointer lines without redrawing the potentiometer', () => {
    const ownerSvg = `<svg viewBox="0 0 144 164"><circle cx="71.5" cy="71" r="49"/><line x1="61" y1="82" x2="42" y2="101" stroke="#132B3A"/><line x1="58.6" y1="84.3" x2="44.2" y2="98.7" stroke="#22435C"/></svg>`;
    const markup = potentiometerRuntimeMarkup(ownerSvg, 0.5);
    expect(markup.match(/transform="rotate\(135 71\.5 71\)"/g)).toHaveLength(2);
    expect(markup).toContain('<circle cx="71.5" cy="71" r="49"/>');
    expect(ownerSvg).not.toContain('transform=');
  });

  it('styles the existing owner multimeter selector paths without drawing duplicate buttons', () => {
    const ownerSvg = `<svg viewBox="0 0 474 247">
      <path d="M415 72 A13 13 0 1 0 389 72 A13 13 0 1 0 415 72 Z" fill="#F2AE16"/>
      <path d="M397 78 L402 66 L407 78 M399.3 73 H404.7" fill="none"/>
      <path d="M415 107 A13 13 0 1 0 389 107 A13 13 0 1 0 415 107 Z" fill="#4E5251"/>
      <path d="M397 101 L402 113 L407 101" fill="none"/>
      <path d="M415 139 A13 13 0 1 0 389 139 A13 13 0 1 0 415 139 Z" fill="#F2AE16"/>
      <path d="M398.5 145.5 V132.5 H402.8 C405.5 132.5 406.8 134.2 406.8 136.2 C406.8 138.8 404.9 140 402.6 140 H398.5 M402 140 L407 145.5" fill="none"/>
    </svg>`;
    const stopped = multimeterRuntimeMarkup(ownerSvg, 'current', '');
    expect(stopped).toContain('workbench-multimeter-mode-current is-active');
    expect(stopped).toContain('workbench-multimeter-mode-voltage"');
    expect(stopped).not.toContain('workbench-multimeter-reading');
    expect(stopped).not.toContain('<circle');
    expect(stopped.match(/<path/g)).toHaveLength(6);

    const running = multimeterRuntimeMarkup(ownerSvg, 'voltage', '3.000 V');
    expect(running).toContain('workbench-multimeter-mode-voltage is-active');
    expect(running).toContain('class="workbench-multimeter-reading"');
    expect(running).toContain('>3.000 V</text>');
    const resistance = multimeterRuntimeMarkup(ownerSvg, 'resistance', '1.000 kΩ');
    expect(resistance).toContain('workbench-multimeter-mode-resistance is-active');
    expect(resistance).toContain('>1.000 kΩ</text>');
    expect(ownerSvg).not.toContain('workbench-multimeter');
    expect(multimeterRuntimeMarkup('<svg><path d="missing"/></svg>', 'voltage', '')).toBe('');
  });

  it('marks only the owner motor gear and maps signed RPM to calm visual motion', () => {
    const ownerSvg =
      '<svg viewBox="0 0 284 245"><g id="body"><path d="M0 0"/></g><g id="gear"><path d="M1 1"/></g></svg>';
    const markup = dcMotorRuntimeMarkup(ownerSvg);
    expect(markup).toContain('<g id="body"><path d="M0 0"/></g>');
    expect(markup).toContain('<g id="gear" class="workbench-dc-motor-gear">');
    expect(ownerSvg).not.toContain('class=');
    expect(dcMotorRuntimeMarkup('<svg><g id="body"/></svg>')).toBe('');
    expect(dcMotorVisualMotion(0)).toEqual({ direction: 'stopped', periodSeconds: null });
    expect(dcMotorVisualMotion(3_000)).toEqual({ direction: 'clockwise', periodSeconds: 2.6 });
    expect(dcMotorVisualMotion(5_750)).toEqual({ direction: 'clockwise', periodSeconds: 2.25 });
    expect(dcMotorVisualMotion(-11_500)).toEqual({
      direction: 'counterclockwise',
      periodSeconds: 1.95,
    });
    expect(dcMotorVisualMotion(23_000)).toEqual({
      direction: 'clockwise',
      periodSeconds: 1.75,
    });
    expect(formatMotorRpm(8420.4)).toBe('8420 об/мин');
    expect(formatMotorRpm(-8420.4)).toBe('−8420 об/мин');
    expect(formatMotorRpm(-0.2)).toBe('0 об/мин');
  });

  it('drives only existing TT shaft highlights from deterministic model time', () => {
    const ownerSvg = `<svg viewBox="0 0 514 810"><rect id="rear-bar" x="52" y="186"/><rect id="rear-bar-highlight" x="59" y="190"/><rect id="top-shaft-inner" x="225" y="61"/><g id="bottom-shaft"><rect class="body" x="226" y="656" width="4" height="67"/><rect x="238" y="656" width="1" height="67"/></g></svg>`;
    const markup = gearmotorRuntimeMarkup(ownerSvg);
    expect(markup).toContain('class="workbench-gearmotor-output-bar"');
    expect(markup).toContain('class="workbench-gearmotor-output-bar-highlight"');
    expect(markup).toContain('class="workbench-gearmotor-motor-shaft-highlight"');
    expect(markup).toContain('<rect id="top-shaft-inner" x="225" y="61"');
    expect(markup).not.toContain('workbench-gearmotor-output-axle-highlight');
    expect(ownerSvg).not.toContain('workbench-gearmotor');
    expect(gearmotorRuntimeMarkup('<svg><rect id="top-shaft-inner"/></svg>')).toBe('');

    expect(gearmotorDiagnosticBodyBounds(514, 810)).toEqual({
      minX: 135,
      minY: 99,
      maxX: 329,
      maxY: 529,
    });
    expect(gearmotorDiagnosticBodyBounds(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    });
    expect(gearmotorRpmBodyPoint(514, 810)).toEqual({ x: 232, y: 200 });
    expect(gearmotorRpmBodyPoint(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ x: 0, y: 0 });

    expect(gearmotorVisualPresentation(1_000, 12_000, 250)).toMatchObject({
      motorDirection: 'clockwise',
      outputDirection: 'clockwise',
    });
    const forward = gearmotorVisualPresentation(1_000, 12_000, 250);
    const reverse = gearmotorVisualPresentation(1_000, -12_000, -250);
    expect(Number.isFinite(forward.motorHighlightShift)).toBe(true);
    expect(Number.isFinite(forward.outputHighlightShift)).toBe(true);
    expect(forward.motorHighlightOpacity).toBeGreaterThanOrEqual(0);
    expect(forward.outputHighlightOpacity).toBeGreaterThanOrEqual(0);
    expect(forward.outputShaftScaleY).toBeGreaterThanOrEqual(0.72);
    expect(forward.outputShaftScaleY).toBeLessThanOrEqual(1);
    expect(Math.abs(forward.outputHighlightShift)).toBeGreaterThan(10);
    expect(forward.motorHighlightShift).not.toBeCloseTo(forward.outputHighlightShift, 4);
    expect(reverse).toMatchObject({
      motorDirection: 'counterclockwise',
      outputDirection: 'counterclockwise',
    });
    expect(reverse.motorHighlightShift).toBeCloseTo(-forward.motorHighlightShift, 10);
    expect(reverse.outputHighlightShift).toBeCloseTo(-forward.outputHighlightShift, 10);
    expect(reverse.motorHighlightOpacity).toBeCloseTo(forward.motorHighlightOpacity, 10);
    expect(reverse.outputHighlightOpacity).toBeCloseTo(forward.outputHighlightOpacity, 10);
    expect(reverse.outputShaftScaleY).toBeCloseTo(forward.outputShaftScaleY, 10);
    const outputEdgeOn = gearmotorVisualPresentation(850, 12_000, 250);
    expect(outputEdgeOn.outputHighlightShift).toBeCloseTo(12, 8);
    expect(outputEdgeOn.outputHighlightOpacity).toBeCloseTo(0, 8);
    expect(outputEdgeOn.outputShaftScaleY).toBeCloseTo(0.72, 8);
    const outputRear = gearmotorVisualPresentation(1_700, 12_000, 250);
    expect(outputRear.outputHighlightShift).toBeCloseTo(0, 8);
    expect(outputRear.outputHighlightOpacity).toBe(0);
    expect(outputRear.outputShaftScaleY).toBeCloseTo(1, 8);
    expect(gearmotorVisualPresentation(5_000, 0, 0)).toEqual({
      motorDirection: 'stopped',
      outputDirection: 'stopped',
      motorHighlightShift: 0,
      motorHighlightOpacity: 0.9,
      outputHighlightShift: 0,
      outputHighlightOpacity: 0.55,
      outputShaftScaleY: 1,
    });
  });
});
