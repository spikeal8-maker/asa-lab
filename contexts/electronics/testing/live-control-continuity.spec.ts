import { describe, expect, it } from 'vitest';
import { solveCircuitWithHeldArduino } from '../domain/solver';
import { oscilloscopeSettings } from '../domain/models/signal-generator-model';
import { compileCircuit, verifyCircuitQuality } from '../domain/simulation';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
  resetElectronicsTimedState,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceResult,
  type ElectronicsTimedInputEvent,
  type ElectronicsTimedState,
} from '../engine';

function document(
  components: unknown[],
  wires: readonly (readonly [string, string, string, string])[],
): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument({
    schemaVersion: 4,
    components,
    connections: wires.map(([fromId, fromTerminal, toId, toTerminal], index) => ({
      id: `w${index}`,
      from: { componentId: fromId, terminal: fromTerminal },
      to: { componentId: toId, terminal: toTerminal },
    })),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function ready(
  doc: ElectronicsEngineDocument,
  horizon: number,
  state: ElectronicsTimedState = resetElectronicsTimedState(),
  events: readonly ElectronicsTimedInputEvent[] = [],
): Extract<ElectronicsTimedAdvanceResult, { executionStatus: 'ready' }> {
  const result = advanceElectronicsToHorizon(doc, {
    requestedHorizonMicroseconds: horizon,
    state,
    inputEvents: events,
  });
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  if (result.executionStatus !== 'ready') throw new Error(JSON.stringify(result.diagnostics));
  return result;
}

const part = (id: string, kind: string, value: number) => ({
  id,
  kind,
  value,
  position: { x: 0, y: 0 },
});

describe('canonical live source and instrument controls', () => {
  it('keeps a generator and meter on one canonical profile across V/A/R', () => {
    const doc = document(
      [
        {
          ...part('generator', 'source', 1_000),
          componentTypeId: 'signal-generator',
          pinIds: ['signal', 'ground'],
          stateProperties: {
            waveform: 'square',
            frequencyHz: 1_000,
            amplitudeVpp: 2,
            dcOffsetVolt: 1,
            outputEnabled: true,
          },
        },
        {
          ...part('meter', 'visual', 0),
          componentTypeId: 'multimeter',
          pinIds: ['v-ohm-ma', 'com'],
          stateProperties: { measurementMode: 'dc-voltage' },
        },
      ],
      [
        ['generator', 'signal', 'meter', 'v-ohm-ma'],
        ['generator', 'ground', 'meter', 'com'],
      ],
    );
    const voltage = ready(doc, 1_000);
    expect(voltage.state.continuation?.clockProfileId).toBe('electrothermal-v1');
    const current = ready(doc, 2_000, voltage.state, [
      {
        atMicroseconds: 1_001,
        targetId: 'meter',
        operation: 'measurementMode',
        payload: 'dc-current',
      },
    ]);
    expect(current.state.continuation?.clockProfileId).toBe('electrothermal-v1');
    expect(
      current.observation.components.find((entry) => entry.componentId === 'meter')
        ?.measurementMode,
    ).toBe('dc-current');
    const resistance = ready(doc, 3_000, current.state, [
      {
        atMicroseconds: 2_001,
        targetId: 'meter',
        operation: 'measurementMode',
        payload: 'resistance',
      },
    ]);
    expect(
      resistance.observation.components.find((entry) => entry.componentId === 'meter')
        ?.measurementMode,
    ).toBe('resistance');
    expect(resistance.observation.quality.passed).toBe(true);
  });
  it('uses explicit live output and display switches over their initial component state', () => {
    const doc = document(
      [
        {
          ...part('generator', 'source', 1_000),
          componentTypeId: 'signal-generator',
          pinIds: ['signal', 'ground'],
          state: true,
          stateProperties: {
            waveform: 'square',
            frequencyHz: 500,
            amplitudeVpp: 5,
            dcOffsetVolt: 0,
            outputEnabled: true,
          },
        },
        {
          ...part('scope', 'visual', 1),
          componentTypeId: 'oscilloscope',
          pinIds: ['signal', 'ground'],
          state: false,
          stateProperties: {
            voltsPerDivision: 1,
            timePerDivisionMs: 1,
            triggerLevelVolt: 0,
            displayEnabled: false,
          },
        },
      ],
      [
        ['generator', 'signal', 'scope', 'signal'],
        ['generator', 'ground', 'scope', 'ground'],
      ],
    );
    const initial = ready(doc, 0);
    const toggled = ready(doc, 1_000, initial.state, [
      { atMicroseconds: 1, targetId: 'generator', operation: 'outputEnabled', payload: false },
      { atMicroseconds: 1, targetId: 'scope', operation: 'displayEnabled', payload: true },
    ]);
    const generator = toggled.observation.components.find(
      (entry) => entry.componentId === 'generator',
    );
    const scope = toggled.observation.components.find((entry) => entry.componentId === 'scope');
    expect(generator?.signalOutputEnabled).toBe(false);
    expect(
      oscilloscopeSettings({
        ...doc.components.find((entry) => entry.id === 'scope')!,
        stateProperties: {
          ...doc.components.find((entry) => entry.id === 'scope')!.stateProperties,
          displayEnabled: true,
        },
      }).displayEnabled,
    ).toBe(true);
    expect(scope?.voltageDrop).toBeCloseTo(0, 8);
    expect(toggled.observation.quality.passed).toBe(true);
    expect(toggled.committedHorizonMicroseconds).toBe(1_000);
  });

  it('accounts for oscilloscope input power in static and timed square-wave observations', () => {
    const doc = document(
      [
        {
          ...part('generator', 'source', 1_000),
          componentTypeId: 'signal-generator',
          pinIds: ['signal', 'ground'],
          state: true,
          stateProperties: {
            waveform: 'square',
            frequencyHz: 500,
            amplitudeVpp: 5,
            dcOffsetVolt: 0,
            outputEnabled: true,
          },
        },
        {
          ...part('scope', 'visual', 1),
          componentTypeId: 'oscilloscope',
          pinIds: ['signal', 'ground'],
          state: true,
          stateProperties: {
            voltsPerDivision: 1,
            timePerDivisionMs: 1,
            triggerLevelVolt: 0,
            displayEnabled: true,
          },
        },
      ],
      [
        ['generator', 'signal', 'scope', 'signal'],
        ['generator', 'ground', 'scope', 'ground'],
      ],
    );
    const solved = solveCircuitWithHeldArduino(doc, 2, new Map());
    const quality = verifyCircuitQuality(doc, compileCircuit(doc), solved, { simulationTimeMs: 2 });
    expect(solved.solved).toBe(true);
    expect(quality.passed).toBe(true);
    const initialDoc: ElectronicsEngineDocument = {
      ...doc,
      components: doc.components.map((component) =>
        component.id === 'generator'
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                waveform: 'sine',
                frequencyHz: 1_000,
              },
            }
          : component,
      ),
    };
    const first = ready(initialDoc, 0);
    const events: ElectronicsTimedInputEvent[] = [
      { atMicroseconds: 1, targetId: 'generator', operation: 'waveform', payload: 'square' },
      { atMicroseconds: 1, targetId: 'generator', operation: 'frequencyHz', payload: 500 },
      { atMicroseconds: 1, targetId: 'scope', operation: 'timePerDivisionMs', payload: 2 },
    ];
    const after = ready(initialDoc, 2_000, first.state, events);
    const generator = after.observation.components.find(
      (entry) => entry.componentId === 'generator',
    );
    const scope = after.observation.components.find((entry) => entry.componentId === 'scope');
    expect(generator?.signalWaveform).toBe('square');
    expect(generator?.signalFrequencyHz).toBe(500);
    expect(scope?.oscilloscopeTimePerDivisionMs).toBe(2);
    expect(scope?.oscilloscopeFrequencyHz).toBe(500);
    expect(after.observation.quality.passed).toBe(true);
    expect(after.committedHorizonMicroseconds).toBe(2_000);
    expect(after.state).toEqual(
      ready(initialDoc, 2_000, resetElectronicsTimedState(), events).state,
    );
  });
  it('resamples generator voltage at each DC horizon after a live waveform event', () => {
    const doc = document(
      [
        {
          ...part('generator', 'source', 1_000),
          componentTypeId: 'signal-generator',
          pinIds: ['signal', 'ground'],
          state: true,
          stateProperties: {
            waveform: 'sine',
            frequencyHz: 1_000,
            amplitudeVpp: 5,
            dcOffsetVolt: 0,
            outputEnabled: true,
          },
        },
        {
          ...part('scope', 'visual', 1),
          componentTypeId: 'oscilloscope',
          pinIds: ['signal', 'ground'],
          state: true,
          stateProperties: { voltsPerDivision: 1, timePerDivisionMs: 1, displayEnabled: true },
        },
      ],
      [
        ['generator', 'signal', 'scope', 'signal'],
        ['generator', 'ground', 'scope', 'ground'],
      ],
    );
    const events: ElectronicsTimedInputEvent[] = [
      { atMicroseconds: 1, targetId: 'generator', operation: 'waveform', payload: 'square' },
      { atMicroseconds: 1, targetId: 'generator', operation: 'frequencyHz', payload: 500 },
    ];
    const atPositivePhase = ready(doc, 500, resetElectronicsTimedState(), events);
    const atNegativePhase = ready(doc, 1_500, atPositivePhase.state);
    const oneShot = ready(doc, 1_500, resetElectronicsTimedState(), events);
    const scopeVoltage = (advance: typeof atPositivePhase) =>
      advance.observation.components.find((entry) => entry.componentId === 'scope')
        ?.oscilloscopeInputVoltageVolt;
    const loadedVoltage = 2.5 * (10_000_000 / (10_000_000 + 50));

    expect(atPositivePhase.state.continuation?.clockProfileId).toBe('dc-inputs-v1');
    expect(scopeVoltage(atPositivePhase)).toBeCloseTo(loadedVoltage, 6);
    expect(scopeVoltage(atNegativePhase)).toBeCloseTo(-loadedVoltage, 6);
    expect(scopeVoltage(oneShot)).toBeCloseTo(-loadedVoltage, 6);
    expect(atNegativePhase.observation).toEqual(oneShot.observation);
    expect(atNegativePhase.state).toEqual(oneShot.state);
    expect(atNegativePhase.observation.quality.passed).toBe(true);
  });
  it('applies supply setpoint at an event barrier while carrying capacitor charge and time', () => {
    const doc = document(
      [
        {
          ...part('supply', 'source', 5),
          componentTypeId: 'regulated-power-supply',
          pinIds: ['positive', 'negative'],
          stateProperties: { voltageSetpointVolt: 5, currentLimitAmp: 1, outputEnabled: true },
        },
        part('r', 'resistor', 1_000),
        {
          ...part('cap', 'visual', 100),
          componentTypeId: 'electrolytic-capacitor',
          pinIds: ['positive', 'negative'],
          stateProperties: { voltageRatingVolt: 25, initialVoltageVolt: 0 },
        },
      ],
      [
        ['supply', 'positive', 'r', 'a'],
        ['r', 'b', 'cap', 'positive'],
        ['cap', 'negative', 'supply', 'negative'],
      ],
    );
    const before = ready(doc, 5_000);
    const chargeBefore = before.observation.components.find(
      (entry) => entry.componentId === 'cap',
    )!.voltageDrop;
    expect(chargeBefore).toBeGreaterThan(0);
    const event = {
      atMicroseconds: 5_001,
      targetId: 'supply',
      operation: 'voltageSetpointVolt',
      payload: 10,
    };
    const after = ready(doc, 10_000, before.state, [event]);
    const chargeAfter = after.observation.components.find(
      (entry) => entry.componentId === 'cap',
    )!.voltageDrop;
    expect(after.committedHorizonMicroseconds).toBe(10_000);
    expect(chargeAfter).toBeGreaterThan(chargeBefore);
    expect(after.state.continuation?.documentDigest).toBe(
      before.state.continuation?.documentDigest,
    );
    const replay = ready(doc, 10_000, resetElectronicsTimedState(), [event]);
    expect(after.observation).toEqual(replay.observation);
    expect(after.state).toEqual(replay.state);
    const reset = ready(doc, 0);
    expect(reset.committedHorizonMicroseconds).toBe(0);
    expect(reset.state.continuation?.serializedState).not.toBe(
      after.state.continuation?.serializedState,
    );
  });

  it('applies scope display settings without resetting supply physics or time', () => {
    const doc = document(
      [
        {
          ...part('supply', 'source', 5),
          componentTypeId: 'regulated-power-supply',
          pinIds: ['positive', 'negative'],
          stateProperties: {
            voltageSetpointVolt: 5,
            currentLimitAmp: 1,
            outputEnabled: true,
          },
        },
        {
          ...part('scope', 'visual', 1),
          componentTypeId: 'oscilloscope',
          pinIds: ['signal', 'ground'],
          state: true,
          stateProperties: {
            voltsPerDivision: 1,
            timePerDivisionMs: 1,
            triggerLevelVolt: 0,
            displayEnabled: true,
          },
        },
        part('load', 'resistor', 1_000),
      ],
      [
        ['supply', 'positive', 'scope', 'signal'],
        ['supply', 'negative', 'scope', 'ground'],
        ['supply', 'positive', 'load', 'a'],
        ['supply', 'negative', 'load', 'b'],
      ],
    );
    const initial = ready(doc, 1_000);
    ready(doc, 2_000, initial.state);
    const after = ready(doc, 2_000, initial.state, [
      { atMicroseconds: 1_001, targetId: 'scope', operation: 'timePerDivisionMs', payload: 2 },
      { atMicroseconds: 1_001, targetId: 'scope', operation: 'voltsPerDivision', payload: 2 },
      { atMicroseconds: 1_001, targetId: 'scope', operation: 'displayEnabled', payload: false },
    ]);
    const supply = after.observation.components.find((entry) => entry.componentId === 'supply');
    const scope = after.observation.components.find((entry) => entry.componentId === 'scope');
    expect(supply?.voltageDrop).toBeCloseTo(5, 1);
    expect(scope?.current).toBeCloseTo(5 / 10_000_000, 9);
    expect(scope?.terminalCurrents?.['signal']).toBeCloseTo(5 / 10_000_000, 9);
    expect(scope?.terminalCurrents?.['ground']).toBeCloseTo(-5 / 10_000_000, 9);
    expect(scope?.oscilloscopeTimePerDivisionMs).toBe(2);
    expect(scope?.oscilloscopeVoltsPerDivision).toBe(2);
    expect(after.observation.quality.passed).toBe(true);
    expect(after.observation.quality.maxKclResidualAmp).toBeLessThan(
      after.observation.quality.kclToleranceAmp,
    );
    expect(after.observation.quality.powerBalanceResidualWatt).toBeLessThan(
      after.observation.quality.powerBalanceToleranceWatt,
    );
    expect(after.committedHorizonMicroseconds).toBe(2_000);
    expect(after.state.continuation?.documentDigest).toBe(
      initial.state.continuation?.documentDigest,
    );
  });

  it('rejects an out-of-range live supply setting without committing it', () => {
    const doc = document(
      [
        {
          ...part('supply', 'source', 5),
          componentTypeId: 'regulated-power-supply',
          pinIds: ['positive', 'negative'],
          stateProperties: { voltageSetpointVolt: 5, currentLimitAmp: 1, outputEnabled: true },
        },
        part('r', 'resistor', 1_000),
      ],
      [
        ['supply', 'positive', 'r', 'a'],
        ['r', 'b', 'supply', 'negative'],
      ],
    );
    const first = ready(doc, 0);
    const rejected = advanceElectronicsToHorizon(doc, {
      requestedHorizonMicroseconds: 1,
      state: first.state,
      inputEvents: [
        { atMicroseconds: 1, targetId: 'supply', operation: 'voltageSetpointVolt', payload: 31 },
      ],
    });
    expect(rejected.executionStatus).toBe('fault');
    expect(rejected.committedHorizonMicroseconds).toBe(0);
    expect(rejected.state).toEqual(first.state);
  });
});
