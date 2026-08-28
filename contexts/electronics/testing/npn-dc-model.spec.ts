import { describe, expect, it, vi } from 'vitest';
import type { SchematicComponent } from '../domain/document';
import type { IterativeDcStampContext } from '../domain/models/device-model';
import {
  canonicalNpnDcProfileRegistry,
  classifyNpnOperatingRegion,
  createNpnDcDevice,
  NPN_DEVICE_MODEL,
  type NpnIterationState,
} from '../domain/models/npn-dc-model';
import { canonicalNonlinearDcProfileRegistry } from '../domain/models/nonlinear-dc-models';

function npn(overrides: Partial<SchematicComponent> = {}): SchematicComponent {
  return {
    id: 'q1',
    kind: 'transistor',
    componentTypeId: 'transistor-npn',
    pinIds: ['collector', 'base', 'emitter'],
    value: 100,
    position: { x: 0, y: 0 },
    stateProperties: { transistorType: 'npn', currentGain: 100 },
    ...overrides,
  };
}

describe('MATH-3 generic NPN DC device model', () => {
  it('normalizes the versioned TO-92 profile and rejects other transistor families', () => {
    const device = createNpnDcDevice(npn());
    expect(device?.instance.parameters).toMatchObject({
      version: 1,
      currentGain: 100,
      baseEmitterVoltageVolt: 0.7,
      saturationVoltageVolt: 0.2,
      earlyVoltageVolt: 100,
      maxCollectorCurrentAmp: 0.2,
      maxPowerWatt: 0.625,
      base: 'base',
      collector: 'collector',
      emitter: 'emitter',
    });
    expect(
      createNpnDcDevice(
        npn({
          componentTypeId: 'transistor-pnp',
          stateProperties: { transistorType: 'pnp' },
        }),
      ),
    ).toBeNull();
    expect(canonicalNpnDcProfileRegistry()).toContain('generic-npn-to92');
    expect(canonicalNonlinearDcProfileRegistry()).toContain('generic-npn-to92');
    expect(canonicalNonlinearDcProfileRegistry()).toContain('earlyVoltageVolt');
  });

  it('fails closed on a non-finite declared NPN parameter', () => {
    expect(
      NPN_DEVICE_MODEL.validate(
        npn({ stateProperties: { transistorType: 'npn', currentGain: Number.NaN } }),
      ),
    ).toEqual([
      expect.objectContaining({
        code: 'invalid_npn_parameter',
        message: expect.stringContaining('hFE'),
      }),
    ]);
  });

  it('classifies cutoff, active and saturation from bounded junction voltages', () => {
    const parameters = NPN_DEVICE_MODEL.normalize(npn()).parameters;
    expect(
      classifyNpnOperatingRegion(parameters, {
        baseEmitterDropVolt: 0.2,
        collectorEmitterDropVolt: 5,
      }),
    ).toBe('cutoff');
    expect(
      classifyNpnOperatingRegion(parameters, {
        baseEmitterDropVolt: 0.71,
        collectorEmitterDropVolt: 2,
      }),
    ).toBe('active');
    expect(
      classifyNpnOperatingRegion(parameters, {
        baseEmitterDropVolt: 0.71,
        collectorEmitterDropVolt: 0.205,
      }),
    ).toBe('saturation');
  });

  it('matches an independent Early-effect reference sweep', () => {
    const instance = NPN_DEVICE_MODEL.normalize(npn());
    // VBE=0.7005 V gives Ib=50 uA. With beta=100 and VA=100 V:
    // Ic = 5 mA * (1 + VCE / 100 V).
    const state: NpnIterationState = {
      region: 'active',
      earlyConductanceSiemens: 0.005 / 100,
    };
    const reference = [
      { vce: 1, collectorMilliamp: 5.05, effectiveGain: 101 },
      { vce: 5, collectorMilliamp: 5.25, effectiveGain: 105 },
      { vce: 10, collectorMilliamp: 5.5, effectiveGain: 110 },
    ];

    for (const row of reference) {
      const observation = NPN_DEVICE_MODEL.observe(instance, state, {
        baseEmitterDropVolt: 0.7005,
        collectorEmitterDropVolt: row.vce,
      });
      expect(observation.baseCurrentAmp * 1_000).toBeCloseTo(0.05, 9);
      expect(observation.collectorCurrentAmp * 1_000).toBeCloseTo(row.collectorMilliamp, 9);
      expect(observation.effectiveCurrentGain).toBeCloseTo(row.effectiveGain, 9);
      expect(
        observation.terminalCurrents.base +
          observation.terminalCurrents.collector +
          observation.terminalCurrents.emitter,
      ).toBeCloseTo(0, 12);
    }
  });

  it('owns nonlinear stamping and produces a calculated overload observation', () => {
    const instance = NPN_DEVICE_MODEL.normalize(npn());
    const stampConductance = vi.fn();
    const stampOffset = vi.fn();
    const stampVccs = vi.fn();
    const context: IterativeDcStampContext = {
      node: (_component, terminal) => ({ emitter: 0, base: 1, collector: 2 })[terminal] ?? 0,
      stampConductance,
      stampOffset,
      stampVccs,
    };
    const enteredActive = NPN_DEVICE_MODEL.evaluateIteration(
      instance,
      NPN_DEVICE_MODEL.initialIterationState(instance),
      { baseEmitterDropVolt: 0.75, collectorEmitterDropVolt: 4 },
    );
    const evaluated = NPN_DEVICE_MODEL.evaluateIteration(instance, enteredActive.state, {
      baseEmitterDropVolt: 0.75,
      collectorEmitterDropVolt: 4,
    });
    NPN_DEVICE_MODEL.stampDc(context, instance, evaluated.state);

    expect(enteredActive.state.earlyConductanceSiemens).toBe(1e-12);
    expect(evaluated.state.region).toBe('active');
    expect(evaluated.state.earlyConductanceSiemens).toBeCloseTo(0.005, 12);
    expect(stampVccs).toHaveBeenCalledWith(2, 0, 1, 0, 10);
    const observation = NPN_DEVICE_MODEL.observe(instance, evaluated.state, {
      baseEmitterDropVolt: 0.75,
      collectorEmitterDropVolt: 4,
    });
    expect(observation.stressState).toBe('burned');
    expect(observation.diagnostics.map((item) => item.code)).toContain('transistor_overcurrent');
  });

  it('reports a directly powered base as current overload even with no collector current', () => {
    const instance = NPN_DEVICE_MODEL.normalize(npn());
    const observation = NPN_DEVICE_MODEL.observe(
      instance,
      { region: 'saturation', earlyConductanceSiemens: 0 },
      { baseEmitterDropVolt: 2.88, collectorEmitterDropVolt: 0.031 },
    );

    expect(observation.baseCurrentAmp).toBeCloseTo(0.218, 6);
    expect(observation.collectorCurrentAmp).toBe(0);
    expect(observation.currentUtilizationPercent).toBeCloseTo(109, 6);
    expect(observation.stressState).toBe('overcurrent');
    expect(observation.diagnostics).toEqual([
      expect.objectContaining({
        code: 'transistor_overcurrent',
        message: expect.stringContaining('ток базы 218.0 мА'),
        suggestedAction: expect.stringContaining('ограничивающий резистор'),
      }),
    ]);
  });
});
