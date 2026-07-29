import { describe, expect, it } from 'vitest';
import {
  COMPONENT_PROPERTY_SCHEMAS,
  defaultComponentProperties,
  legacyValueToComponentProperties,
  validateComponentProperties,
} from '../domain/component-properties';

describe('typed native component properties', () => {
  it('defines one schema for every current component kind', () => {
    expect(Object.keys(COMPONENT_PROPERTY_SCHEMAS).sort()).toEqual([
      'breadboard',
      'led',
      'resistor',
      'source',
      'wire',
    ]);
  });

  it('maps the legacy scalar resistor value without losing native defaults', () => {
    expect(legacyValueToComponentProperties('resistor', 4_700)).toEqual({
      resistanceOhm: 4_700,
      tolerancePercent: '5',
      leadSpanPitches: 10,
    });
  });

  it('maps fixed source and LED values into typed property objects', () => {
    expect(legacyValueToComponentProperties('source', 3)).toEqual({
      voltageV: 3,
      chemistry: '2xAA',
    });
    expect(legacyValueToComponentProperties('led', 2)).toEqual({
      color: 'red',
      forwardVoltageV: 2,
      maximumCurrentA: 0.02,
    });
  });

  it.each(['source', 'resistor', 'led', 'breadboard', 'wire'] as const)(
    'validates default %s properties',
    (kind) => {
      expect(validateComponentProperties(kind, defaultComponentProperties(kind))).toMatchObject({
        ok: true,
      });
    },
  );

  it('rejects ownership and arbitrary over-posting as unknown component properties', () => {
    const properties = {
      ...defaultComponentProperties('resistor'),
      tenantId: 'foreign-tenant',
    };
    expect(validateComponentProperties('resistor', properties)).toMatchObject({
      ok: false,
      code: 'unknown_property',
      property: 'tenantId',
    });
  });

  it('rejects missing, wrong-type and out-of-range electrical properties', () => {
    expect(
      validateComponentProperties('resistor', {
        resistanceOhm: 300,
        tolerancePercent: '5',
      }),
    ).toMatchObject({ ok: false, code: 'missing_property', property: 'leadSpanPitches' });

    expect(
      validateComponentProperties('resistor', {
        resistanceOhm: '300',
        tolerancePercent: '5',
        leadSpanPitches: 10,
      }),
    ).toMatchObject({ ok: false, code: 'invalid_property_type', property: 'resistanceOhm' });

    expect(
      validateComponentProperties('resistor', {
        resistanceOhm: 0,
        tolerancePercent: '5',
        leadSpanPitches: 10,
      }),
    ).toMatchObject({ ok: false, code: 'property_out_of_range', property: 'resistanceOhm' });

    expect(
      validateComponentProperties('resistor', {
        resistanceOhm: 300,
        tolerancePercent: '3',
        leadSpanPitches: 10,
      }),
    ).toMatchObject({
      ok: false,
      code: 'property_value_not_allowed',
      property: 'tolerancePercent',
    });
  });

  it('does not treat the breadboard as a scalar-valued electrical load', () => {
    expect(COMPONENT_PROPERTY_SCHEMAS.breadboard.legacyValueKey).toBeNull();
    expect(defaultComponentProperties('breadboard')).toEqual({
      boardKind: 'half-400',
      pitchMm: 2.54,
    });
  });
});
