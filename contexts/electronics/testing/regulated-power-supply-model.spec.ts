import { describe, expect, it, vi } from 'vitest';
import type { ElectronicsDocument, SchematicComponent, Terminal } from '../domain/document';
import { parseElectronicsDocument } from '../domain/document';
import { electricalModelIdentityForComponent } from '../domain/model-identity';
import {
  createLinearDcDevice,
  isRegulatedPowerSupplyDevice,
  REGULATED_POWER_SUPPLY_DEVICE_MODEL,
  regulatedPowerSupplyStampForMode,
} from '../domain/models/linear-dc-models';
import { solveCircuit } from '../domain/solver';

function supply(
  stateProperties: SchematicComponent['stateProperties'],
  options: Partial<SchematicComponent> = {},
): SchematicComponent {
  return {
    id: 'supply',
    kind: 'source',
    componentTypeId: 'regulated-power-supply',
    value: 5,
    position: { x: 0, y: 0 },
    pinIds: ['positive', 'negative'],
    stateProperties,
    ...options,
  };
}

function resistor(resistanceOhm: number): SchematicComponent {
  return {
    id: 'load',
    kind: 'resistor',
    componentTypeId: 'resistor-axial',
    value: resistanceOhm,
    position: { x: 100, y: 0 },
    pinIds: ['lead-1', 'lead-2'],
  };
}

function connect(id: string, fromTerminal: Terminal, toTerminal: Terminal) {
  return {
    id,
    from: { componentId: 'supply', terminal: fromTerminal },
    to: { componentId: 'load', terminal: toTerminal },
    color: '#159447',
    vertices: [],
  };
}

function circuit(source: SchematicComponent, load: SchematicComponent): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 4,
    components: [source, load],
    connections: [
      connect('positive', 'positive', 'lead-1'),
      connect('negative', 'negative', 'lead-2'),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 24 },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

describe('MATH-10B regulated laboratory power supply', () => {
  it('upgrades the temporary ideal-source identity to its own versioned model', () => {
    expect(
      electricalModelIdentityForComponent(
        supply(
          { voltageSetpointVolt: 5, currentLimitAmp: 1, outputEnabled: false },
          {
            electricalModelId: 'ideal-dc-source',
            electricalModelVersion: 1,
            modelProfileId: 'generic-regulated-power-supply',
            modelProfileVersion: 1,
          },
        ),
      ),
    ).toEqual({
      electricalModelId: 'regulated-dc-supply',
      electricalModelVersion: 1,
      modelProfileId: 'asa-bench-supply-30v-5a',
      modelProfileVersion: 1,
    });
  });

  it('normalizes bounded controls and stamps finite CV, CC and off equivalents', () => {
    const device = createLinearDcDevice(
      supply({ voltageSetpointVolt: 12, currentLimitAmp: 0.25, outputEnabled: true }),
    );
    expect(device && isRegulatedPowerSupplyDevice(device)).toBe(true);
    if (!device || !isRegulatedPowerSupplyDevice(device)) return;
    expect(device.instance.parameters).toEqual({
      outputEnabled: true,
      voltageSetpointVolt: 12,
      currentLimitAmp: 0.25,
      outputResistanceOhm: 0.05,
    });
    expect(regulatedPowerSupplyStampForMode(device.instance, 'cv')).toEqual({
      emfVolt: 12,
      seriesResistanceOhm: 0.05,
    });
    expect(regulatedPowerSupplyStampForMode(device.instance, 'cc')).toEqual({
      emfVolt: 250_000,
      seriesResistanceOhm: 1_000_000,
    });
    expect(regulatedPowerSupplyStampForMode(device.instance, 'off')).toEqual({
      emfVolt: 0,
      seriesResistanceOhm: 1_000_000_000_000,
    });

    const stampVoltageSource = vi.fn();
    REGULATED_POWER_SUPPLY_DEVICE_MODEL.stampDc(
      {
        node: (_component, terminal) => (terminal === 'a' ? 2 : 1),
        stampConductance: vi.fn(),
        stampVoltageSource,
      },
      device.instance,
    );
    expect(stampVoltageSource).toHaveBeenCalledWith('supply', 2, 1, 12, 0.05);
  });

  it('holds voltage in CV and reports actual terminal voltage and current', () => {
    const result = solveCircuit(
      circuit(
        supply({ voltageSetpointVolt: 5, currentLimitAmp: 0.2, outputEnabled: true }),
        resistor(100),
      ),
    );
    const source = result.components.find((entry) => entry.componentId === 'supply');
    expect(result.solved).toBe(true);
    expect(source).toMatchObject({
      regulatedOutputEnabled: true,
      regulationMode: 'cv',
      voltageSetpointVolt: 5,
      currentLimitAmp: 0.2,
    });
    expect(source?.voltageDrop).toBeCloseTo(4.9975, 3);
    expect(source?.current).toBeCloseTo(0.049975, 5);
  });

  it('transitions to CC and limits current under a heavy load', () => {
    const result = solveCircuit(
      circuit(
        supply({ voltageSetpointVolt: 5, currentLimitAmp: 0.1, outputEnabled: true }),
        resistor(10),
      ),
    );
    const source = result.components.find((entry) => entry.componentId === 'supply');
    expect(result.solved).toBe(true);
    expect(source?.regulationMode).toBe('cc');
    expect(source?.current).toBeCloseTo(0.1, 5);
    expect(source?.voltageDrop).toBeCloseTo(1, 4);
    expect(source?.temperatureCelsius).toBeGreaterThan(25);
  });

  it('makes an off output electrically open and keeps all observations finite', () => {
    const result = solveCircuit(
      circuit(
        supply({ voltageSetpointVolt: 30, currentLimitAmp: 5, outputEnabled: false }),
        resistor(0.1),
      ),
    );
    const source = result.components.find((entry) => entry.componentId === 'supply');
    expect(result.solved).toBe(true);
    expect(source).toMatchObject({
      regulatedOutputEnabled: false,
      regulationMode: 'off',
      voltageDrop: 0,
      current: 0,
    });
    expect(
      Object.values(source ?? {})
        .flat()
        .filter((value) => typeof value === 'number')
        .every(Number.isFinite),
    ).toBe(true);
  });

  it('limits a direct short in CC without reporting an unbounded-source fault', () => {
    const parsed = parseElectronicsDocument({
      schemaVersion: 4,
      components: [supply({ voltageSetpointVolt: 12, currentLimitAmp: 0.2, outputEnabled: true })],
      connections: [
        {
          id: 'short',
          from: { componentId: 'supply', terminal: 'positive' },
          to: { componentId: 'supply', terminal: 'negative' },
          color: '#159447',
          vertices: [],
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: true, maxIterations: 24 },
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const result = solveCircuit(parsed.document);
    const source = result.components.find((entry) => entry.componentId === 'supply');
    expect(result.solved).toBe(true);
    expect(source?.regulationMode).toBe('cc');
    expect(source?.current).toBeCloseTo(0.2, 5);
    expect(source?.voltageDrop).toBe(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'short_circuit')).toBe(
      false,
    );
  });

  it('accepts a zero-amp limit and reduces the enabled output to zero current', () => {
    const result = solveCircuit(
      circuit(
        supply({ voltageSetpointVolt: 12, currentLimitAmp: 0, outputEnabled: true }),
        resistor(10),
      ),
    );
    const source = result.components.find((entry) => entry.componentId === 'supply');
    expect(result.solved).toBe(true);
    expect(source?.regulationMode).toBe('cc');
    expect(source?.current).toBe(0);
    expect(source?.voltageDrop).toBe(0);
    expect(source?.currentUtilizationPercent).toBe(0);
  });
});
