import { describe, expect, it, vi } from 'vitest';
import type { SchematicComponent } from '../domain/document';
import type { DcStampContext } from '../domain/models/device-model';
import {
  createLinearDcDevice,
  isResistorDevice,
  isSourceDevice,
  RESISTOR_DEVICE_MODEL,
  SOURCE_DEVICE_MODEL,
} from '../domain/models/linear-dc-models';

function component(
  id: string,
  kind: SchematicComponent['kind'],
  value: number,
  options: Partial<SchematicComponent> = {},
): SchematicComponent {
  return { id, kind, value, position: { x: 0, y: 0 }, ...options };
}

describe('MATH-1 linear DC device models', () => {
  it('normalizes source and resistor profiles from versioned model identities', () => {
    const source = createLinearDcDevice(
      component('battery', 'source', 4.5, { componentTypeId: 'battery-holder-aa-3' }),
    );
    const resistor = createLinearDcDevice(
      component('r1', 'resistor', 220, {
        componentTypeId: 'resistor-axial',
        stateProperties: { powerRatingWatt: 0.5 },
      }),
    );

    expect(source && isSourceDevice(source) ? source.instance.parameters : null).toEqual({
      emfVolt: 4.5,
      internalResistanceOhm: 0.675,
      continuousCurrentAmp: 1,
    });
    expect(resistor && isResistorDevice(resistor) ? resistor.instance.parameters : null).toEqual({
      resistanceOhm: 220,
      powerRatingWatt: 0.5,
    });
  });

  it('stamps only through the restricted DC context', () => {
    const stampConductance = vi.fn();
    const stampVoltageSource = vi.fn();
    const context: DcStampContext = {
      node: (_component, terminal) => (terminal === 'a' ? 1 : 0),
      stampConductance,
      stampVoltageSource,
    };
    const resistor = RESISTOR_DEVICE_MODEL.normalize(component('r1', 'resistor', 100));
    const source = SOURCE_DEVICE_MODEL.normalize(component('source', 'source', 5));

    RESISTOR_DEVICE_MODEL.stampDc(context, resistor);
    SOURCE_DEVICE_MODEL.stampDc(context, source);

    expect(stampConductance).toHaveBeenCalledWith(1, 0, 0.01);
    expect(stampVoltageSource).toHaveBeenCalledWith('source', 1, 0, 5, 1e-12);
  });

  it('does not guess a model for an incompatible persisted identity', () => {
    const incompatible = component('r1', 'resistor', 100, {
      componentTypeId: 'resistor-axial',
      electricalModelId: 'future-resistor',
      electricalModelVersion: 7,
      modelProfileId: 'future-profile',
      modelProfileVersion: 2,
    });
    expect(createLinearDcDevice(incompatible)).toBeNull();
  });
});
