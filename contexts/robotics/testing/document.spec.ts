import { describe, expect, it } from 'vitest';
import { parseElectronicsEngineDocument } from '@asa-lab/electronics/engine';
import {
  createInitialRoboticsProject,
  parseRoboticsProject,
  type RoboticsProject,
} from '../domain/document.js';
import {
  createRoboticsBall,
  createRoboticsFloorMark,
  createRoboticsWorldDocument,
} from '../domain/world.js';

function authoredProject(): RoboticsProject {
  const project = createInitialRoboticsProject();
  return {
    ...project,
    circuit: {
      ...project.circuit,
      schemaVersion: 5,
      annotations: [
        {
          id: 'construction-note',
          text: 'Сохранённая конструкция',
          position: { x: 20, y: 40 },
          size: { width: 180, height: 80 },
          fontSize: 16,
        },
      ],
      viewport: { x: -12, y: 31, zoom: 0.75 },
    },
    world: {
      ...project.world,
      field: {
        ...project.world.field,
        gridMeters: 0.05,
        balls: [
          {
            ...createRoboticsBall('ball-1', { xMeters: 0.8, yMeters: 0.4 }),
            rollingResistanceCoefficient: 0.02,
            contactFrictionCoefficient: 0.3,
          },
        ],
        floorMarks: [createRoboticsFloorMark('area', 'area-1', { xMeters: 0.4, yMeters: 1.3 })],
      },
      robot: { ...project.world.robot, sensorLateralMeters: 0.01 },
    },
  };
}

describe('shared Robotics authored document', () => {
  it('creates a complete independent M1 starter without browser state', () => {
    expect(typeof document).toBe('undefined');
    const first = createInitialRoboticsProject();
    const second = createInitialRoboticsProject();
    expect(first).toEqual(second);
    expect(first.circuit.components).not.toBe(second.circuit.components);
    expect(first.world.field.obstacles).not.toBe(second.world.field.obstacles);
    expect(first.circuit.components).toHaveLength(9);
    expect(first.circuit.connections).toHaveLength(17);
    expect(first.circuit.components.find(({ id }) => id === 'uno')?.stateProperties).toMatchObject({
      arduinoCodeMode: 'blocks',
      arduinoSerialOpen: false,
      arduinoSource: expect.stringContaining('void loop()'),
      arduinoWorkspace: expect.stringContaining('robotics-safe-rover'),
    });
    expect(first.circuit.simulation.running).toBe(false);
    expect(parseElectronicsEngineDocument(first.circuit).ok).toBe(true);
    expect(parseRoboticsProject(first)).toEqual({ ok: true, project: first });
  });

  it('round-trips the entire circuit, program, annotations, construction and field', () => {
    const source = authoredProject();
    const parsed = parseRoboticsProject(JSON.parse(JSON.stringify(source)));
    expect(parsed).toEqual({ ok: true, project: source });
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.project.circuit).not.toBe(source.circuit);
    expect(parsed.project.world).not.toBe(source.world);
  });

  it('stops simulation and ignores transient world state without mutating input', () => {
    const source = authoredProject();
    const running = {
      ...source,
      circuit: { ...source.circuit, simulation: { ...source.circuit.simulation, running: true } },
      world: {
        ...source.world,
        runtime: { atMicroseconds: 1000, pose: { xMeters: 1, yMeters: 1 } },
      },
      runtime: { leftRpm: 90 },
    };
    expect(parseRoboticsProject(running)).toEqual({ ok: true, project: source });
    expect(running.circuit.simulation.running).toBe(true);
    expect(running.world.runtime.atMicroseconds).toBe(1000);
  });

  it('saves an unfinished circuit without requiring the bound components to exist', () => {
    const initial = createInitialRoboticsProject();
    const unfinished = {
      ...initial,
      circuit: { ...initial.circuit, components: [], connections: [] },
    };
    expect(parseRoboticsProject(unfinished)).toEqual({ ok: true, project: unfinished });
  });

  it('migrates a local v1 world without changing the Arduino source or wiring', () => {
    const initial: RoboticsProject = {
      ...createInitialRoboticsProject(),
      schemaVersion: 2,
      world: createRoboticsWorldDocument(),
    };
    const legacy = {
      ...initial,
      schemaVersion: 1,
      world: {
        ...initial.world,
        physicsProfile: undefined,
        field: { ...initial.world.field, balls: undefined, floorMarks: undefined },
      },
    };
    expect(parseRoboticsProject(legacy)).toEqual({ ok: true, project: initial });
  });

  it.each([
    ['future schema', (source: RoboticsProject) => ({ ...source, schemaVersion: 4 })],
    [
      'missing required physics',
      (source: RoboticsProject) => ({
        ...source,
        world: { ...source.world, physicsProfile: undefined },
      }),
    ],
    [
      'missing required objects',
      (source: RoboticsProject) => ({
        ...source,
        world: { ...source.world, field: { ...source.world.field, balls: undefined } },
      }),
    ],
    [
      'non-finite geometry',
      (source: RoboticsProject) => ({
        ...source,
        world: { ...source.world, initialPose: { ...source.world.initialPose, xMeters: NaN } },
      }),
    ],
    [
      'out-of-bounds pose',
      (source: RoboticsProject) => ({
        ...source,
        world: { ...source.world, initialPose: { ...source.world.initialPose, xMeters: -1 } },
      }),
    ],
    ['legacy label limit', (source: RoboticsProject) => ({ ...source, title: 'я'.repeat(81) })],
  ])('rejects %s as source rather than silently substituting a starter', (_name, mutate) => {
    const result = parseRoboticsProject(mutate(createInitialRoboticsProject()));
    expect(result).toMatchObject({ ok: false, message: expect.any(String) });
  });

  it('uses canonical Electronics validation for malformed circuits', () => {
    const source = createInitialRoboticsProject();
    const result = parseRoboticsProject({
      ...source,
      circuit: { ...source.circuit, schemaVersion: 99 },
    });
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/^Схема:/) });
  });
});
