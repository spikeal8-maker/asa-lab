import { describe, expect, it, vi } from 'vitest';
import type { SchematicComponent } from '../domain/document';
import type { IterativeDcStampContext } from '../domain/models/device-model';
import {
  canonicalPnpDcProfileRegistry,
  classifyPnpOperatingRegion,
  createPnpDcDevice,
  PNP_DEVICE_MODEL,
} from '../domain/models/pnp-dc-model';

function pnp(overrides: Partial<SchematicComponent> = {}): SchematicComponent {
  return {
    id: 'q1',
    kind: 'transistor',
    componentTypeId: 'transistor-pnp',
    pinIds: ['collector', 'base', 'emitter'],
    value: 100,
    position: { x: 0, y: 0 },
    stateProperties: { transistorType: 'pnp', currentGain: 100 },
    ...overrides,
  };
}

describe('MATH-4B2 mirrored PNP DC device model', () => {
  it('normalizes the versioned PNP profile and rejects another transistor family', () => {
    expect(createPnpDcDevice(pnp())?.instance.parameters).toMatchObject({
      version: 1,
      currentGain: 100,
      baseEmitterVoltageVolt: 0.7,
      saturationVoltageVolt: 0.2,
      earlyVoltageVolt: 100,
      maxCollectorCurrentAmp: 0.2,
      maxPowerWatt: 0.625,
    });
    expect(
      createPnpDcDevice(
        pnp({
          componentTypeId: 'transistor-npn',
          stateProperties: { transistorType: 'npn' },
        }),
      ),
    ).toBeNull();
    expect(canonicalPnpDcProfileRegistry()).toContain('generic-pnp-to92');
  });

  it('classifies emitter-relative cutoff, active and saturation regions', () => {
    const parameters = PNP_DEVICE_MODEL.normalize(pnp()).parameters;
    expect(
      classifyPnpOperatingRegion(parameters, {
        baseEmitterDropVolt: 0.2,
        collectorEmitterDropVolt: 5,
      }),
    ).toBe('cutoff');
    expect(
      classifyPnpOperatingRegion(parameters, {
        baseEmitterDropVolt: 0.71,
        collectorEmitterDropVolt: 2,
      }),
    ).toBe('active');
    expect(
      classifyPnpOperatingRegion(parameters, {
        baseEmitterDropVolt: 0.71,
        collectorEmitterDropVolt: 0.205,
      }),
    ).toBe('saturation');
  });

  it('stamps the mirrored active branch and reports KCL-consistent terminal currents', () => {
    const instance = PNP_DEVICE_MODEL.normalize(pnp());
    const stampConductance = vi.fn();
    const stampOffset = vi.fn();
    const stampVccs = vi.fn();
    const context: IterativeDcStampContext = {
      node: (_component, terminal) => ({ emitter: 0, base: 1, collector: 2 })[terminal] ?? 0,
      stampConductance,
      stampOffset,
      stampVccs,
    };
    const enteredActive = PNP_DEVICE_MODEL.evaluateIteration(
      instance,
      PNP_DEVICE_MODEL.initialIterationState(instance),
      { baseEmitterDropVolt: 0.75, collectorEmitterDropVolt: 4 },
    );
    const evaluated = PNP_DEVICE_MODEL.evaluateIteration(instance, enteredActive.state, {
      baseEmitterDropVolt: 0.75,
      collectorEmitterDropVolt: 4,
    });
    PNP_DEVICE_MODEL.stampDc(context, instance, evaluated.state);

    expect(evaluated.state.region).toBe('active');
    expect(stampVccs).toHaveBeenCalledWith(0, 2, 0, 1, 10);
    const observation = PNP_DEVICE_MODEL.observe(instance, evaluated.state, {
      baseEmitterDropVolt: 0.75,
      collectorEmitterDropVolt: 4,
    });
    expect(
      observation.terminalCurrents.base +
        observation.terminalCurrents.collector +
        observation.terminalCurrents.emitter,
    ).toBeCloseTo(0, 12);
    expect(observation.terminalCurrents.emitter).toBeGreaterThan(0);
    expect(observation.terminalCurrents.base).toBeLessThan(0);
  });
});
