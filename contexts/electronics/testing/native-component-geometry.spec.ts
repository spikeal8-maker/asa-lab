import { describe, expect, it } from 'vitest';
import {
  ACTIVE_NATIVE_COMPONENT_GEOMETRY,
  NATIVE_GRID_PITCH_MM,
  calibratedAssetSizeMm,
  createAxialResistorGeometry,
  rotateNativePoint,
  rotatedEnvelopeMm,
  terminalDistanceMm,
  validateNativeComponentGeometry,
  type NativeComponentGeometry,
} from '../domain/native-component-geometry';

describe('native component geometry', () => {
  it('validates every active native component model', () => {
    for (const geometry of Object.values(ACTIVE_NATIVE_COMPONENT_GEOMETRY)) {
      expect(validateNativeComponentGeometry(geometry)).toEqual({ ok: true });
    }
  });

  it('calibrates the owner battery SVG from its stable terminal span', () => {
    const source = ACTIVE_NATIVE_COMPONENT_GEOMETRY.source;
    const size = calibratedAssetSizeMm(source.assetCalibration!);
    expect(size.widthMm).toBeCloseTo(46.9333, 3);
    expect(size.heightMm).toBeCloseTo(81.5611, 3);
    expect(terminalDistanceMm(source, 'a', 'b')).toBeCloseTo(10.16, 6);
    expect(size.widthMm).toBeLessThanOrEqual(source.envelopeMm.widthMm);
    expect(size.heightMm).toBeLessThanOrEqual(source.envelopeMm.heightMm);
  });

  it('keeps the resistor body native while the lead footprint changes', () => {
    const fourPitch = createAxialResistorGeometry(4);
    const tenPitch = createAxialResistorGeometry(10);
    const twentyPitch = createAxialResistorGeometry(20);

    expect(fourPitch.bodyMm).toEqual(tenPitch.bodyMm);
    expect(tenPitch.bodyMm).toEqual(twentyPitch.bodyMm);
    expect(terminalDistanceMm(fourPitch, 'a', 'b')).toBeCloseTo(4 * NATIVE_GRID_PITCH_MM, 6);
    expect(terminalDistanceMm(tenPitch, 'a', 'b')).toBeCloseTo(10 * NATIVE_GRID_PITCH_MM, 6);
    expect(terminalDistanceMm(twentyPitch, 'a', 'b')).toBeCloseTo(
      20 * NATIVE_GRID_PITCH_MM,
      6,
    );
    expect(fourPitch.envelopeMm.widthMm).toBeLessThan(tenPitch.envelopeMm.widthMm);
    expect(tenPitch.envelopeMm.widthMm).toBeLessThan(twentyPitch.envelopeMm.widthMm);
  });

  it('rejects unsupported resistor lead spans instead of silently distorting the asset', () => {
    for (const pitch of [0, 3, 4.5, 21, Number.NaN]) {
      expect(() => createAxialResistorGeometry(pitch)).toThrow(/pitchMultiple/);
    }
  });

  it('keeps LED anode and cathode exactly one breadboard pitch apart', () => {
    const led = ACTIVE_NATIVE_COMPONENT_GEOMETRY.led;
    expect(terminalDistanceMm(led, 'a', 'b')).toBeCloseTo(NATIVE_GRID_PITCH_MM, 6);
    expect(led.terminals.map((terminal) => [terminal.id, terminal.role])).toEqual([
      ['a', 'anode'],
      ['b', 'cathode'],
    ]);
  });

  it.each([0, 90, 180, 270] as const)(
    'preserves terminal distance after %s degree rotation',
    (rotation) => {
      const geometry = createAxialResistorGeometry(10);
      const [a, b] = geometry.terminals;
      const ra = rotateNativePoint(geometry.envelopeMm, a!, rotation);
      const rb = rotateNativePoint(geometry.envelopeMm, b!, rotation);
      expect(Math.hypot(rb.xMm - ra.xMm, rb.yMm - ra.yMm)).toBeCloseTo(25.4, 6);
      const rotated = rotatedEnvelopeMm(geometry.envelopeMm, rotation);
      if (rotation === 90 || rotation === 270) {
        expect(rotated.widthMm).toBe(geometry.envelopeMm.heightMm);
        expect(rotated.heightMm).toBe(geometry.envelopeMm.widthMm);
      } else {
        expect(rotated).toEqual(geometry.envelopeMm);
      }
    },
  );

  it('rejects duplicate and outside terminal geometry', () => {
    const base = createAxialResistorGeometry(10);
    const duplicate: NativeComponentGeometry = {
      ...base,
      terminals: [base.terminals[0]!, { ...base.terminals[1]!, id: base.terminals[0]!.id }],
    };
    expect(validateNativeComponentGeometry(duplicate)).toMatchObject({
      ok: false,
      code: 'duplicate_terminal_id',
    });

    const outside: NativeComponentGeometry = {
      ...base,
      terminals: [
        base.terminals[0]!,
        { ...base.terminals[1]!, xMm: base.envelopeMm.widthMm + 1 },
      ],
    };
    expect(validateNativeComponentGeometry(outside)).toMatchObject({
      ok: false,
      code: 'terminal_outside_envelope',
    });
  });
});
