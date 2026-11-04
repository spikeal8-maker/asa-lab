import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  advanceElectronicsToHorizon,
  createElectronicsAdvanceSession,
  parseElectronicsEngineDocument,
  projectElectronicsArduinoSerial,
  resetElectronicsTimedState,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceRequest,
  type ElectronicsTimedAdvanceResult,
  type ElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import { terminalPosition } from '../../electronics/component-catalog';
import {
  configureProductionLibrary,
  productionCatalogEntry,
  type OwnerCatalogManifest,
} from '../../electronics/production-manifest-adapter';
import { readArduinoProgramState } from '../../electronics/arduino-program-state';
import {
  createDefaultRoboticsProject,
  parseRoboticsProject,
  ROBOTICS_ARDUINO_SOURCE,
  validateRoboticsBindings,
  withRoboticsWorld,
  type RoboticsProject,
} from '../robotics-project';
import {
  advanceRoboticsWorld,
  createRoboticsWorldDocument,
  createRoboticsWorldState,
  findRoboticsCollision,
  measureRoboticsDistance,
} from '../world';

beforeAll(() => {
  configureProductionLibrary(
    JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'apps/web/public/assets/electronics/component-database/catalog.json',
        ),
        'utf8',
      ),
    ) as OwnerCatalogManifest,
  );
});

function engineDocument(project: RoboticsProject): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument(project.circuit);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

/** Exercise the same public bounded session used by the Worker, without decoding continuation. */
function canonicalAdvance(
  document: ElectronicsEngineDocument,
  request: ElectronicsTimedAdvanceRequest,
): Exclude<ElectronicsTimedAdvanceResult, { executionStatus: 'yielded' }> {
  let state = request.state ?? resetElectronicsTimedState();
  let inputEvents = request.inputEvents ?? [];
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const session = createElectronicsAdvanceSession(document, {
      ...request,
      state,
      inputEvents,
      maxEvents: 128,
    });
    let completed: ElectronicsTimedAdvanceResult | undefined;
    try {
      for (let step = 0; step < 2048; step += 1) {
        const result = session.step();
        if (result) {
          completed = result;
          break;
        }
      }
    } finally {
      session.dispose();
    }
    if (!completed) throw new Error('Canonical advance did not finish its bounded request.');
    if (completed.executionStatus !== 'yielded') return completed;
    state = completed.state;
    inputEvents = [];
  }
  throw new Error('Canonical advance exhausted its continuation attempts.');
}

function readyAdvance(
  document: ElectronicsEngineDocument,
  request: ElectronicsTimedAdvanceRequest,
) {
  const result = canonicalAdvance(document, request);
  if (result.executionStatus !== 'ready') throw new Error(JSON.stringify(result.diagnostics));
  expect(result.observation.solved).toBe(true);
  expect(result.observation.quality.passed).toBe(true);
  return result;
}

describe('Robotics project built from the real Electronics catalogue', () => {
  it('retains canonical model metadata, physical pins and all 17 actual connections', () => {
    const project = createDefaultRoboticsProject();
    expect(validateRoboticsBindings(project)).toBeNull();
    expect(project.circuit.components).toHaveLength(9);
    expect(project.circuit.connections).toHaveLength(17);
    for (const component of project.circuit.components) {
      const entry = productionCatalogEntry(component.componentTypeId ?? '');
      expect(entry?.enabled, component.id).toBe(true);
      expect(entry?.simulationSupported, component.id).toBe(true);
      expect(component.value, component.id).toBe(entry?.defaultValue);
      expect(component.rotation, component.id).toBe(entry?.defaultRotation);
      expect(component.pinIds, component.id).toEqual(Object.keys(entry!.terminals));
      expect(component.electricalModelId, component.id).toBeTruthy();
      expect(component.modelProfileId, component.id).toBeTruthy();
    }
    for (const wire of project.circuit.connections) {
      for (const terminal of [wire.from, wire.to]) {
        const component = project.circuit.components.find(
          (item) => item.id === terminal.componentId,
        );
        expect(component?.pinIds).toContain(terminal.terminal);
        expect(
          terminalPosition(
            component!,
            component!.position,
            terminal.terminal,
            component!.rotation ?? 0,
          ),
        ).not.toBeNull();
      }
    }
    expect(project.circuit.components.find((item) => item.id === 'battery')?.pinIds).toEqual([
      'BAT-',
      'BAT+',
    ]);
    expect(project.circuit.components.find((item) => item.id === 'left-fet')?.value).toBe(2);
    const board = project.circuit.components.find((item) => item.id === 'uno')!;
    expect(board.pinIds).toHaveLength(31);
    expect(readArduinoProgramState(board.stateProperties)).toMatchObject({
      mode: 'text',
      source: ROBOTICS_ARDUINO_SOURCE,
    });
    const sonar = project.circuit.components.find((item) => item.id === 'sonar')!;
    expect(sonar.stateProperties?.distanceMeters).toBeCloseTo(1.245, 12);
    expect(parseElectronicsEngineDocument(project.circuit).ok).toBe(true);
  });

  it('round-trips source, block workspace, field, bindings and disconnected edits without inventing server state', () => {
    const original = createDefaultRoboticsProject();
    const workspaceJson = JSON.stringify({
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'asa_setup', id: 'saved-setup', x: 365, y: 84 },
          { type: 'asa_loop', id: 'saved-loop', x: 494, y: 120 },
        ],
      },
    });
    const project: RoboticsProject = {
      ...original,
      circuit: {
        ...original.circuit,
        components: original.circuit.components.map((component) =>
          component.id === 'uno'
            ? {
                ...component,
                stateProperties: {
                  ...component.stateProperties,
                  arduinoCodeMode: 'blocks-text',
                  arduinoWorkspace: workspaceJson,
                },
              }
            : component,
        ),
        connections: original.circuit.connections.slice(1),
      },
    };
    const restored = parseRoboticsProject(JSON.parse(JSON.stringify(project)));
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.project).toEqual(project);
    expect(restored.project.circuit).not.toBe(project.circuit);
    expect(restored.project.circuit.components[0]).not.toBe(project.circuit.components[0]);
    expect(
      readArduinoProgramState(restored.project.circuit.components[0]!.stateProperties),
    ).toMatchObject({
      mode: 'blocks-text',
      workspaceJson,
      source: ROBOTICS_ARDUINO_SOURCE,
    });
    const running = parseRoboticsProject({
      ...project,
      circuit: { ...project.circuit, simulation: { ...project.circuit.simulation, running: true } },
    });
    expect(running.ok && running.project.circuit.simulation.running).toBe(false);
  });

  it('updates only the initial environment during an explicit stopped field change', () => {
    const original = createDefaultRoboticsProject();
    const originalJson = JSON.stringify(original);
    const next = withRoboticsWorld(original, createRoboticsWorldDocument('compact'));
    expect(JSON.stringify(original)).toBe(originalJson);
    expect(next.circuit.connections).toBe(original.circuit.connections);
    expect(next.circuit.components.find((item) => item.id === 'uno')).toBe(
      original.circuit.components.find((item) => item.id === 'uno'),
    );
    expect(
      next.circuit.components.find((item) => item.id === 'sonar')?.stateProperties?.distanceMeters,
    ).toBeCloseTo(0.645, 12);
    const expectedWorld = createRoboticsWorldDocument('compact');
    expect(next.world).toEqual(expectedWorld);
  });

  it('keeps a malformed assembly editable but rejects its Run binding and invalid storage schemas', () => {
    const original = createDefaultRoboticsProject();
    const removedMotor: RoboticsProject = {
      ...original,
      circuit: {
        ...original.circuit,
        components: original.circuit.components.filter((item) => item.id !== 'left-motor'),
        connections: original.circuit.connections.filter(
          (wire) => wire.from.componentId !== 'left-motor' && wire.to.componentId !== 'left-motor',
        ),
      },
    };
    expect(parseRoboticsProject(removedMotor).ok).toBe(true);
    expect(validateRoboticsBindings(removedMotor)).toContain('Левый мотор');
    const wrongMotor: RoboticsProject = {
      ...original,
      circuit: {
        ...original.circuit,
        components: original.circuit.components.map((item) =>
          item.id === 'left-motor' ? { ...item, componentTypeId: 'servo-motor' } : item,
        ),
      },
    };
    expect(validateRoboticsBindings(wrongMotor)).toContain('неподдерживаемый тип');
    expect(parseRoboticsProject({ ...original, schemaVersion: 2 }).ok).toBe(false);
    expect(
      parseRoboticsProject({ ...original, circuit: { ...original.circuit, schemaVersion: 999 } })
        .ok,
    ).toBe(false);
    expect(
      parseRoboticsProject({
        ...original,
        world: { ...original.world, robot: { ...original.world.robot, wheelRadiusMeters: '65mm' } },
      }).ok,
    ).toBe(false);
  });
});

describe('Robotics fixture running the unchanged canonical Arduino and electric motor engine', () => {
  it('produces the same full electrical result through the bounded Worker-facing session and the canonical direct API', () => {
    const document = engineDocument(createDefaultRoboticsProject());
    const request = { requestedHorizonMicroseconds: 100_000, maxEvents: 128 };
    const workerPath = readyAdvance(document, request);
    let direct = advanceElectronicsToHorizon(document, request);
    let yields = 0;
    while (direct.executionStatus === 'yielded' && yields < 128) {
      expect(direct.observation).toBeNull();
      direct = advanceElectronicsToHorizon(document, { ...request, state: direct.state });
      yields += 1;
    }
    expect(yields).toBeGreaterThan(0);
    expect(direct).toStrictEqual(workerPath);
    for (const id of ['left-motor', 'right-motor']) {
      const motor = workerPath.observation.components.find(
        (component) => component.componentId === id,
      );
      expect(motor?.outputRpm).toBeGreaterThan(100);
      expect(motor?.motorRpm).toBeGreaterThan((motor?.outputRpm ?? 0) * 40);
    }
  });

  it('changes the actual GPIO and motor observations through Serial L/R/S, never direct robot speed commands', () => {
    const document = engineDocument(createDefaultRoboticsProject());
    let result = readyAdvance(document, { requestedHorizonMicroseconds: 100_000 });
    for (const [index, command, leftHigh, rightHigh] of [
      [0, 'L', false, true],
      [1, 'R', true, false],
      [2, 'S', false, false],
    ] as const) {
      result = readyAdvance(document, {
        requestedHorizonMicroseconds: (index + 2) * 100_000,
        state: result.state,
        inputEvents: [
          {
            atMicroseconds: (index + 1) * 100_000 + 1,
            targetId: 'uno',
            operation: 'serialRx',
            payload: command,
          },
        ],
      });
      const board = result.observation.components.find(
        (component) => component.componentId === 'uno',
      )!;
      expect(board.terminalVoltages.d5).toBeCloseTo(leftHigh ? 5 : 0, 8);
      expect(board.terminalVoltages.d6).toBeCloseTo(rightHigh ? 5 : 0, 8);
      if (!leftHigh) {
        const motor = result.observation.components.find(
          (component) => component.componentId === 'left-motor',
        )!;
        expect(motor.motorOperatingMode).toBe('coasting');
        expect(motor.outputRpm).toBeGreaterThan(0);
      }
    }
    // Serial is read by the next sketch loop, not at host button time. Compare
    // a complete coast interval only after both GPIO outputs are confirmed LOW.
    const later = readyAdvance(document, {
      requestedHorizonMicroseconds: 500_000,
      state: result.state,
    });
    for (const id of ['left-motor', 'right-motor']) {
      const before = result.observation.components.find(
        (component) => component.componentId === id,
      )!;
      const after = later.observation.components.find((component) => component.componentId === id)!;
      expect(after.motorOperatingMode).toBe('coasting');
      expect(after.outputRpm).toBeLessThan(before.outputRpm!);
    }
  });

  it('blocks forward near an obstacle but accepts real Serial turns to move away without resetting', () => {
    const initial = createDefaultRoboticsProject();
    const project = withRoboticsWorld(initial, {
      ...initial.world,
      field: {
        ...initial.world.field,
        obstacles: initial.world.field.obstacles.map((obstacle) => ({
          ...obstacle,
          xMeters: 0.455,
        })),
      },
    });
    const document = engineDocument(project);
    const sourceBytes = JSON.stringify(project);
    let result = readyAdvance(document, { requestedHorizonMicroseconds: 100_000 });
    let worldState = createRoboticsWorldState(project.world);
    const initialBoard = result.observation.components.find((item) => item.componentId === 'uno')!;
    expect(initialBoard.terminalVoltages.d5).toBe(0);
    expect(initialBoard.terminalVoltages.d6).toBe(0);
    for (const id of ['left-motor', 'right-motor'])
      expect(result.observation.components.find((item) => item.componentId === id)?.outputRpm).toBe(
        0,
      );
    worldState = advanceRoboticsWorld(project.world, worldState, {
      atMicroseconds: result.committedHorizonMicroseconds,
      leftRpm: 0,
      rightRpm: 0,
    });
    for (const [index, command, poweredId, leftHigh, rightHigh] of [
      [0, 'L', 'right-motor', false, true],
      [1, 'R', 'left-motor', true, false],
    ] as const) {
      const measured = measureRoboticsDistance(project.world, worldState.pose);
      if (measured.status !== 'ok') throw new Error(measured.message);
      expect(measured.distanceMeters).toBeLessThan(0.6);
      result = readyAdvance(document, {
        requestedHorizonMicroseconds: (index + 2) * 100_000,
        state: result.state,
        inputEvents: [
          {
            atMicroseconds: worldState.atMicroseconds + 1,
            targetId: 'sonar',
            operation: 'distanceMeters',
            payload: measured.distanceMeters,
          },
          {
            atMicroseconds: worldState.atMicroseconds + 2,
            targetId: 'uno',
            operation: 'serialRx',
            payload: command,
          },
        ],
      });
      const board = result.observation.components.find((item) => item.componentId === 'uno')!;
      expect(board.terminalVoltages.d5).toBeCloseTo(leftHigh ? 5 : 0, 8);
      expect(board.terminalVoltages.d6).toBeCloseTo(rightHigh ? 5 : 0, 8);
      const powered = result.observation.components.find((item) => item.componentId === poweredId)!;
      expect(powered.motorOperatingMode).toBe('running');
      expect(powered.outputRpm).toBeGreaterThan(0);
      const left = result.observation.components.find((item) => item.componentId === 'left-motor')!;
      const right = result.observation.components.find(
        (item) => item.componentId === 'right-motor',
      )!;
      worldState = advanceRoboticsWorld(project.world, worldState, {
        atMicroseconds: result.committedHorizonMicroseconds,
        leftRpm: left.outputRpm!,
        rightRpm: right.outputRpm!,
      });
      expect(worldState.haltReason).toBeNull();
      expect(findRoboticsCollision(project.world, worldState.pose)).toBeNull();
    }
    expect(worldState.pose.xMeters).toBeGreaterThan(project.world.initialPose.xMeters);
    expect(worldState.pose.headingRadians).toBeGreaterThan(0);
    expect(JSON.stringify(project)).toBe(sourceBytes);
  });

  it('closes the world → HC-SR04 → pulseIn → GPIO → motor loop and preserves a real coasting margin', () => {
    const initial = createDefaultRoboticsProject();
    const project = withRoboticsWorld(initial, createRoboticsWorldDocument('compact'));
    const document = engineDocument(project);
    const sourceBytes = JSON.stringify(project);
    let timedState: ElectronicsTimedState = resetElectronicsTimedState();
    let worldState = createRoboticsWorldState(project.world);
    let powered = false;
    let powerRemoved = false;
    let lastRpm = 0;
    for (let horizon = 50_000; horizon <= 2_000_000; horizon += 50_000) {
      const measured = measureRoboticsDistance(project.world, worldState.pose);
      if (measured.status !== 'ok') throw new Error(measured.message);
      const result = readyAdvance(document, {
        requestedHorizonMicroseconds: horizon,
        state: timedState,
        inputEvents:
          horizon === 50_000
            ? []
            : [
                {
                  atMicroseconds: worldState.atMicroseconds + 1,
                  targetId: project.world.bindings.distanceSensorId,
                  operation: 'distanceMeters',
                  payload: measured.distanceMeters,
                },
              ],
      });
      timedState = result.state;
      const board = result.observation.components.find((item) => item.componentId === 'uno')!;
      const left = result.observation.components.find((item) => item.componentId === 'left-motor')!;
      const right = result.observation.components.find(
        (item) => item.componentId === 'right-motor',
      )!;
      if ((board.terminalVoltages.d5 ?? 0) > 4.9) powered = true;
      else if (powered) {
        powerRemoved = true;
        expect(left.motorOperatingMode).toBe('coasting');
      }
      worldState = advanceRoboticsWorld(project.world, worldState, {
        atMicroseconds: result.committedHorizonMicroseconds,
        leftRpm: left.outputRpm!,
        rightRpm: right.outputRpm!,
      });
      expect(worldState.haltReason).toBeNull();
      lastRpm = left.outputRpm!;
    }
    expect(powered).toBe(true);
    expect(powerRemoved).toBe(true);
    expect(worldState.pose.xMeters).toBeGreaterThan(project.world.initialPose.xMeters + 0.1);
    expect(worldState.pose.yMeters).toBeCloseTo(project.world.initialPose.yMeters, 6);
    expect(lastRpm).toBeLessThan(5);
    const finalDistance = measureRoboticsDistance(project.world, worldState.pose);
    expect(finalDistance.status).toBe('ok');
    expect(finalDistance.distanceMeters).toBeGreaterThan(0.25);
    const echoes = projectElectronicsArduinoSerial(timedState).flatMap((board) =>
      board.tx.map((entry) => Number(entry.text.trim())),
    );
    expect(echoes.some((value) => value > 3480)).toBe(true);
    expect(echoes.some((value) => value > 0 && value < 3480)).toBe(true);
    expect(JSON.stringify(project)).toBe(sourceBytes);
  }, 15_000);

  it('does not power a motor after its real positive wire is removed', () => {
    const project = createDefaultRoboticsProject();
    const disconnected: RoboticsProject = {
      ...project,
      circuit: {
        ...project.circuit,
        connections: project.circuit.connections.filter(
          (wire) => !(wire.from.componentId === 'battery' && wire.to.componentId === 'left-motor'),
        ),
      },
    };
    const result = readyAdvance(engineDocument(disconnected), {
      requestedHorizonMicroseconds: 300_000,
    });
    const left = result.observation.components.find((item) => item.componentId === 'left-motor')!;
    const right = result.observation.components.find((item) => item.componentId === 'right-motor')!;
    expect(left.outputRpm).toBe(0);
    expect(left.energized).toBe(false);
    expect(right.outputRpm).toBeGreaterThan(100);
    const moved = advanceRoboticsWorld(project.world, createRoboticsWorldState(project.world), {
      atMicroseconds: 300_000,
      leftRpm: left.outputRpm!,
      rightRpm: right.outputRpm!,
    });
    expect(moved.pose.headingRadians).toBeGreaterThan(0);
  });
});
