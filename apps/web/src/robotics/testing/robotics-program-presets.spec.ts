/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import * as ScratchBlocks from 'scratch-blocks';
import { analyseArduinoSourceSupport } from '@asa-lab/electronics';
import {
  createElectronicsAdvanceSession,
  parseElectronicsEngineDocument,
  projectElectronicsArduinoSerial,
  resetElectronicsTimedState,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceResult,
  type ElectronicsTimedInputEvent,
  type ElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import { applyArduinoBlockDefaults, generateArduinoCode } from '../../electronics/arduino-blocks';
import {
  createRoboticsProgramPreset,
  DEFAULT_ROBOTICS_PROGRAM_PRESET_ID,
  ROBOTICS_PROGRAM_PRESETS,
  type RoboticsPresetProgram,
} from '../robotics-program-presets';

function withWorkspace<T>(
  program: RoboticsPresetProgram,
  use: (workspace: ScratchBlocks.Workspace) => T,
): T {
  const workspace = new ScratchBlocks.Workspace();
  ScratchBlocks.Events.disable();
  try {
    ScratchBlocks.serialization.workspaces.load(JSON.parse(program.workspaceJson), workspace);
    applyArduinoBlockDefaults(workspace);
    return use(workspace);
  } finally {
    workspace.dispose();
    ScratchBlocks.Events.enable();
  }
}

/** Actual Uno and HC-SR04 models, with small resistive GPIO loads and an SPDT
 * selecting ECHO or ground. Its second position creates a defined no-echo LOW.
 * The public engine owns all execution, pin voltages and continuation state. */
function circuit(program: RoboticsPresetProgram, distanceMeters = 1): ElectronicsEngineDocument {
  const wires: readonly (readonly [string, string, string, string])[] = [
    ['uno', 'power-5v', 'sonar', 'vcc'],
    ['uno', 'power-gnd-1', 'sonar', 'gnd'],
    ['uno', 'd13', 'sonar', 'trigger'],
    ['sonar', 'echo', 'echo-link', 'throw-left'],
    ['echo-link', 'common', 'uno', 'd2'],
    ['echo-link', 'throw-right', 'uno', 'power-gnd-1'],
    ['uno', 'd5', 'left-load', 'a'],
    ['left-load', 'b', 'uno', 'power-gnd-1'],
    ['uno', 'd6', 'right-load', 'a'],
    ['right-load', 'b', 'uno', 'power-gnd-1'],
  ];
  const parsed = parseElectronicsEngineDocument({
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        componentTypeId: 'arduino-uno',
        value: 5,
        position: { x: 0, y: 0 },
        pinIds: [
          ...Array.from({ length: 14 }, (_, pin) => `d${pin}`),
          ...Array.from({ length: 6 }, (_, pin) => `a${pin}`),
          'power-5v',
          'power-3v3',
          'power-gnd-1',
        ],
        stateProperties: {
          arduinoCodeMode: program.mode,
          arduinoSource: program.source,
          arduinoWorkspace: program.workspaceJson,
          arduinoInputPins: program.inputPins,
        },
      },
      {
        id: 'sonar',
        kind: 'visual',
        componentTypeId: 'ultrasonic-hc-sr04',
        value: 0,
        position: { x: 100, y: 0 },
        pinIds: ['vcc', 'trigger', 'echo', 'gnd'],
        stateProperties: { distanceMeters },
      },
      {
        id: 'echo-link',
        kind: 'switch',
        componentTypeId: 'switch-spdt',
        pinIds: ['throw-left', 'common', 'throw-right'],
        value: 0,
        state: false,
        position: { x: 150, y: 0 },
      },
      ...['left-load', 'right-load'].map((id) => ({
        id,
        kind: 'resistor',
        value: 1000,
        position: { x: 200, y: 0 },
      })),
    ],
    connections: wires.map(([fromId, fromTerminal, toId, toTerminal], index) => ({
      id: `wire-${index}`,
      from: { componentId: fromId, terminal: fromTerminal },
      to: { componentId: toId, terminal: toTerminal },
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

type Ready = Extract<ElectronicsTimedAdvanceResult, { executionStatus: 'ready' }>;

function advance(
  document: ElectronicsEngineDocument,
  requestedHorizonMicroseconds: number,
  previous?: ElectronicsTimedState,
  inputs: readonly ElectronicsTimedInputEvent[] = [],
): Ready {
  let state = previous ?? resetElectronicsTimedState();
  let inputEvents = inputs;
  for (let request = 0; request < 128; request += 1) {
    const session = createElectronicsAdvanceSession(document, {
      requestedHorizonMicroseconds,
      state,
      inputEvents,
      maxEvents: 128,
    });
    let result: ElectronicsTimedAdvanceResult | null | undefined;
    try {
      for (let quantum = 0; quantum < 2048 && !result; quantum += 1) result = session.step();
    } finally {
      session.dispose();
    }
    if (!result) throw new Error('The public engine did not complete its bounded request.');
    if (result.executionStatus === 'fault') throw new Error(JSON.stringify(result.diagnostics));
    if (result.executionStatus === 'ready') {
      expect(result.observation.solved, JSON.stringify(result.observation.diagnostics)).toBe(true);
      expect(result.observation.quality.passed).toBe(true);
      expect(result.committedHorizonMicroseconds).toBe(requestedHorizonMicroseconds);
      return result;
    }
    state = result.state;
    inputEvents = [];
  }
  throw new Error('The public engine exceeded its continuation bound.');
}

function expectDrive(result: Ready, leftHigh: boolean, rightHigh: boolean): void {
  const board = result.observation.components.find((component) => component.componentId === 'uno');
  expect(board).toBeDefined();
  for (const [pin, high] of [
    ['d5', leftHigh],
    ['d6', rightHigh],
  ] as const) {
    const voltage = board!.terminalVoltages[pin];
    expect(voltage).toBeTypeOf('number');
    if (high) expect(voltage).toBeGreaterThan(4.5);
    else expect(Math.abs(voltage!)).toBeLessThan(1e-7);
  }
}

function serialEchoes(result: Ready): number[] {
  return projectElectronicsArduinoSerial(result.state).flatMap((board) =>
    board.tx.map((entry) => Number(entry.text.trim())),
  );
}

describe('Robotics presets use the shared editable Arduino workspace', () => {
  it.each(ROBOTICS_PROGRAM_PRESETS)(
    'round-trips $id through real blocks and the canonical generator',
    ({ id }) => {
      const program = createRoboticsProgramPreset(id);
      expect(program.mode).toBe('blocks');
      expect(program.inputPins).toContain('2');
      expect(
        analyseArduinoSourceSupport(program.source).filter(
          (entry) => entry.status === 'unsupported',
        ),
      ).toEqual([]);
      withWorkspace(program, (workspace) => {
        expect(
          workspace
            .getTopBlocks(false)
            .map((block) => block.type)
            .sort(),
        ).toEqual(['asa_loop', 'asa_setup']);
        expect(workspace.getAllBlocks(false).every((block) => block.type.startsWith('asa_'))).toBe(
          true,
        );
        expect(generateArduinoCode(workspace, program.inputPins)).toBe(program.source);
        const restored: RoboticsPresetProgram = {
          ...program,
          workspaceJson: JSON.stringify(ScratchBlocks.serialization.workspaces.save(workspace)),
        };
        withWorkspace(restored, (again) => {
          expect(generateArduinoCode(again, restored.inputPins)).toBe(program.source);
        });
      });
      expect(program.source).toContain('pinMode(2, INPUT);');
    },
  );

  it('does not edit an already open workspace or leak its event suppression', () => {
    const saved = createRoboticsProgramPreset(DEFAULT_ROBOTICS_PROGRAM_PRESET_ID);
    withWorkspace(saved, (workspace) => {
      const before = JSON.stringify(ScratchBlocks.serialization.workspaces.save(workspace));
      const eventsEnabled = ScratchBlocks.Events.isEnabled();
      for (const preset of ROBOTICS_PROGRAM_PRESETS) createRoboticsProgramPreset(preset.id);
      expect(ScratchBlocks.Events.isEnabled()).toBe(eventsEnabled);
      expect(JSON.stringify(ScratchBlocks.serialization.workspaces.save(workspace))).toBe(before);
      expect(generateArduinoCode(workspace, saved.inputPins)).toBe(saved.source);
    });
  });

  it('executes a learner change of the echo threshold from the saved numeric block', () => {
    const original = createRoboticsProgramPreset('safe-rover');
    const changed = withWorkspace(original, (workspace): RoboticsPresetProgram => {
      const assignment = workspace.getAllBlocks(false).find((block) => {
        if (block.type !== 'asa_var_set') return false;
        const id = block.getFieldValue('NAME') as string;
        return workspace.getVariableMap().getVariableById(id)?.getName() === 'safeStopEchoUs';
      });
      expect(assignment).toBeDefined();
      assignment!.getInputTargetBlock('VALUE')!.setFieldValue('10000', 'VALUE');
      return {
        ...original,
        source: generateArduinoCode(workspace, original.inputPins),
        workspaceJson: JSON.stringify(ScratchBlocks.serialization.workspaces.save(workspace)),
      };
    });
    expect(changed.source).not.toBe(original.source);
    expectDrive(advance(circuit(original), 20_000), true, true);
    expectDrive(advance(circuit(changed), 20_000), false, false);
  });
});

describe('Generated robot programs execute on the canonical electrical engine', () => {
  it.each([0.3, 1])(
    'handles F/L/R/S at %sm through actual HC-SR04 and Serial input events',
    (distanceMeters) => {
      const document = circuit(createRoboticsProgramPreset('safe-rover'), distanceMeters);
      let result = advance(document, 20_000);
      expectDrive(result, distanceMeters > 0.6, distanceMeters > 0.6);
      expect(serialEchoes(result)[0]).toBeGreaterThan(0);

      for (const [command, horizon, left, right] of [
        ['L', 80_000, false, true],
        ['R', 140_000, true, false],
        ['S', 200_000, false, false],
        ['F', 250_000, distanceMeters > 0.6, distanceMeters > 0.6],
      ] as const) {
        result = advance(document, horizon, result.state, [
          {
            atMicroseconds: result.committedHorizonMicroseconds + 1,
            targetId: 'uno',
            operation: 'serialRx',
            payload: command,
          },
        ]);
        expectDrive(result, left, right);
      }
    },
  );

  it('removes previous drive before waiting for missing echo and stays off after the one-second timeout', () => {
    const document = circuit(createRoboticsProgramPreset('safe-rover'));
    const moving = advance(document, 20_000);
    expectDrive(moving, true, true);
    expect(serialEchoes(moving)).toHaveLength(1);
    expect(serialEchoes(moving)[0]).toBeGreaterThan(3480);

    const waiting = advance(document, 80_000, moving.state, [
      {
        atMicroseconds: 25_000,
        targetId: 'echo-link',
        operation: 'state',
        payload: true,
      },
    ]);
    expectDrive(waiting, false, false);
    expect(serialEchoes(waiting)).toEqual(serialEchoes(moving));

    const timedOut = advance(document, 1_100_000, waiting.state);
    expectDrive(timedOut, false, false);
    expect(serialEchoes(timedOut).at(-1)).toBe(0);
    expect(serialEchoes(timedOut)).toHaveLength(2);
  });

  it.each([
    ['turn-left', false, 500_000],
    ['push-one-shot', true, 800_000],
  ] as const)('performs %s once, then leaves both GPIO outputs LOW', (id, leftHigh, duration) => {
    const document = circuit(createRoboticsProgramPreset(id));
    const powered = advance(document, duration - 10_000);
    expectDrive(powered, leftHigh, true);
    const off = advance(document, duration + 1000, powered.state);
    expectDrive(off, false, false);
    const later = advance(document, 1_900_000, off.state);
    expectDrive(later, false, false);
  });
});
