import { describe, expect, it } from 'vitest';
import type { ElectronicsDocument, SchematicComponent } from '../domain/document';
import {
  observeActivePiezo,
  PENDING_SMALL_SPEAKER_PROFILE,
  piezoDcResistanceOhm,
} from '../domain/models/piezo-audio-model';
import {
  electricalModelIdentityForComponent,
  resolveElectricalModelIdentity,
} from '../domain/model-identity';
import { analyseCircuit } from '../domain/simulation';

function source(voltage: number): SchematicComponent {
  return { id: 'source', kind: 'source', position: { x: 0, y: 0 }, value: voltage };
}

function piezo(
  mode: 'active' | 'passive',
  componentTypeId: 'piezo-passive-buzzer' | 'piezo-disc' = 'piezo-passive-buzzer',
): SchematicComponent {
  return {
    id: 'sounder',
    kind: 'piezo',
    componentTypeId,
    position: { x: 0, y: 0 },
    value: 0,
    pinIds: ['positive', 'negative'],
    stateProperties: { piezoMode: mode },
  };
}

function poweredPiezo(
  voltage: number,
  mode: 'active' | 'passive',
  reversed = false,
): ElectronicsDocument {
  return {
    schemaVersion: 4,
    components: [source(voltage), piezo(mode)],
    connections: [
      {
        id: 'positive',
        from: { componentId: 'source', terminal: 'a' },
        to: { componentId: 'sounder', terminal: reversed ? 'negative' : 'positive' },
      },
      {
        id: 'negative',
        from: { componentId: 'sounder', terminal: reversed ? 'positive' : 'negative' },
        to: { componentId: 'source', terminal: 'b' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 24 },
  };
}

describe('MATH-8A piezo and future speaker audio contract', () => {
  it('makes the active buzzer draw finite current and sound from correct-polarity DC', () => {
    const result = analyseCircuit(poweredPiezo(5, 'active'));
    const sounder = result.components.find((component) => component.componentId === 'sounder');
    expect(result.status).toBe('solved');
    expect(result.quality).toMatchObject({ finite: true, passed: true });
    expect(sounder).toMatchObject({
      piezoMode: 'active',
      piezoDriveState: 'sounding',
      energized: true,
      frequencyHz: 2300,
      soundLevel: 0.8,
      operatingVoltageMinVolt: 3,
      operatingVoltageMaxVolt: 12,
    });
    expect(sounder?.current).toBeCloseTo(0.015, 8);
    expect(sounder?.power).toBeCloseTo(0.075, 8);
  });

  it('starts from a nominal 3 V AA pack despite the normal loaded terminal sag', () => {
    const document = poweredPiezo(3, 'active');
    const result = analyseCircuit({
      ...document,
      components: document.components.map((component) =>
        component.id === 'source'
          ? {
              ...component,
              componentTypeId: 'battery-holder-aa-2',
              pinIds: ['BAT-', 'BAT+'],
            }
          : component,
      ),
      connections: document.connections.map((connection) => ({
        ...connection,
        from:
          connection.from.componentId === 'source'
            ? { ...connection.from, terminal: 'BAT+' }
            : connection.from,
        to:
          connection.to.componentId === 'source'
            ? { ...connection.to, terminal: 'BAT-' }
            : connection.to,
      })),
    });
    const sounder = result.components.find((component) => component.componentId === 'sounder');
    expect(result.status).toBe('solved');
    expect(sounder).toBeDefined();
    expect(sounder?.voltageDrop).toBeGreaterThanOrEqual(2.95);
    expect(sounder?.voltageDrop).toBeLessThan(3);
    expect(sounder).toMatchObject({
      piezoDriveState: 'sounding',
      energized: true,
      frequencyHz: 2300,
    });
  });

  it('keeps passive DC silent while preserving the Arduino-tone model separately', () => {
    const result = analyseCircuit(poweredPiezo(5, 'passive'));
    expect(
      result.components.find((component) => component.componentId === 'sounder'),
    ).toMatchObject({
      piezoMode: 'passive',
      piezoDriveState: 'silent',
      energized: false,
      frequencyHz: 0,
      soundLevel: 0,
    });
    expect(piezoDcResistanceOhm(piezo('passive'))).toBe(100_000_000);

    const reversed = analyseCircuit(poweredPiezo(5, 'passive', true));
    expect(reversed.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'piezo_reverse_polarity' }),
    );
  });

  it('silences reversed active power and reports a clear polarity warning', () => {
    const result = analyseCircuit(poweredPiezo(5, 'active', true));
    expect(
      result.components.find((component) => component.componentId === 'sounder'),
    ).toMatchObject({
      piezoDriveState: 'reverse_polarity',
      energized: false,
      frequencyHz: 0,
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'piezo_reverse_polarity',
        severity: 'warning',
        componentIds: ['sounder'],
      }),
    );
  });

  it('keeps overvoltage finite and visible without inventing an instant permanent failure', () => {
    const result = analyseCircuit(poweredPiezo(15, 'active'));
    const sounder = result.components.find((component) => component.componentId === 'sounder');
    expect(result.quality).toMatchObject({ finite: true, passed: true });
    expect(sounder).toMatchObject({
      piezoDriveState: 'overvoltage',
      energized: true,
      stressState: 'warning',
      damageState: 'none',
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'piezo_overvoltage', severity: 'warning' }),
    );
  });

  it('keeps the future variable-frequency speaker fail-closed until owner art exists', () => {
    expect(PENDING_SMALL_SPEAKER_PROFILE).toEqual({
      id: 'small-speaker-8ohm-pending-owner-svg',
      availability: 'disabled_missing_owner_svg',
      nominalImpedanceOhm: 8,
      frequencyMinHz: 100,
      frequencyMaxHz: 8000,
      supportsVariableFrequency: true,
    });
    expect(observeActivePiezo(piezo('active', 'piezo-disc'), 2.5)).toMatchObject({
      driveState: 'below_voltage',
      energized: false,
    });
    expect(observeActivePiezo(piezo('active'), 2.996)).toMatchObject({
      driveState: 'sounding',
      energized: true,
      frequencyHz: 2300,
    });
  });

  it('upgrades saved passive-only piezo identities to the active/passive profile', () => {
    expect(
      resolveElectricalModelIdentity({
        kind: 'piezo',
        componentTypeId: 'piezo-passive-buzzer',
      }),
    ).toEqual({
      electricalModelId: 'piezo-transducer',
      electricalModelVersion: 1,
      modelProfileId: 'piezo-enclosed-audio',
      modelProfileVersion: 2,
    });
    expect(
      electricalModelIdentityForComponent({
        ...piezo('passive'),
        electricalModelId: 'passive-piezo',
        electricalModelVersion: 1,
        modelProfileId: 'passive-piezo-enclosed',
        modelProfileVersion: 1,
      }),
    ).toEqual({
      electricalModelId: 'piezo-transducer',
      electricalModelVersion: 1,
      modelProfileId: 'piezo-enclosed-audio',
      modelProfileVersion: 2,
    });
  });
});
