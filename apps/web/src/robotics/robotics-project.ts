import { parseElectronicsEngineDocument } from '@asa-lab/electronics/engine';
import type { SchematicDocument } from '../api';
import { productionCatalogEntry } from '../electronics/production-manifest-adapter';
import { addComponentToDocument } from '../electronics/workbench-document';
import type { RoboticsPresetProgram } from './robotics-program-presets';
import {
  createRoboticsWorldDocument,
  measureRoboticsDistance,
  parseRoboticsWorldDocument,
  type RoboticsWorldDocument,
} from './world';

export interface RoboticsProject {
  readonly schemaVersion: 2;
  readonly title: string;
  readonly circuit: SchematicDocument;
  readonly world: RoboticsWorldDocument;
}

export const ROBOTICS_ARDUINO_SOURCE = `// ASA Lab: два мотора через FET, HC-SR04 и настоящее выполнение Arduino.
// Serial: F — вперёд, L — влево, R — вправо, S — отключить приводы.
// LOW даёт свободный выбег. Порог 3480 мкс (60 см) оставляет запас для остановки.
// Датчик запрещает ход вперёд; L/R позволяют отвернуть от препятствия.
int command = 70;
int safeStopEchoUs = 3480;
unsigned long duration = 0;

void setup() {
  pinMode(5, OUTPUT);
  pinMode(6, OUTPUT);
  pinMode(13, OUTPUT);
  pinMode(2, INPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(13, LOW);
  delayMicroseconds(2);
  digitalWrite(13, HIGH);
  delayMicroseconds(10);
  digitalWrite(13, LOW);
  duration = pulseIn(2, HIGH, 30000);

  if (Serial.available() > 0) {
    command = Serial.read();
  }

  if (command == 76) {
    digitalWrite(5, LOW);
    digitalWrite(6, HIGH);
  } else if (command == 82) {
    digitalWrite(5, HIGH);
    digitalWrite(6, LOW);
  } else if (command == 70 && duration > safeStopEchoUs) {
    digitalWrite(5, HIGH);
    digitalWrite(6, HIGH);
  } else {
    digitalWrite(5, LOW);
    digitalWrite(6, LOW);
  }

  Serial.println(duration);
  delay(50);
}
`;

const PRESET_COMPONENTS = [
  ['uno', 'arduino-uno', 340, 690],
  ['battery', 'battery-holder-aa-4', 1150, 710],
  ['sonar', 'ultrasonic-hc-sr04', 340, 240],
  ['left-motor', 'gearmotor', 800, 240],
  ['right-motor', 'gearmotor', 1270, 240],
  ['left-fet', 'transistor-fet', 800, 470],
  ['right-fet', 'transistor-fet', 1270, 470],
  ['left-flyback', 'diode-do41', 940, 470],
  ['right-flyback', 'diode-do41', 1410, 470],
] as const;

const PRESET_CONNECTIONS: readonly (readonly [string, string, string, string])[] = [
  ['uno', 'power-gnd-1', 'battery', 'BAT-'],
  ['uno', 'power-5v', 'sonar', 'vcc'],
  ['uno', 'power-gnd-1', 'sonar', 'gnd'],
  ['uno', 'd13', 'sonar', 'trigger'],
  ['sonar', 'echo', 'uno', 'd2'],
  ['battery', 'BAT+', 'left-motor', 'positive'],
  ['left-motor', 'negative', 'left-fet', 'drain'],
  ['left-fet', 'source', 'battery', 'BAT-'],
  ['uno', 'd5', 'left-fet', 'gate'],
  ['left-flyback', 'anode', 'left-motor', 'negative'],
  ['left-flyback', 'cathode', 'left-motor', 'positive'],
  ['battery', 'BAT+', 'right-motor', 'positive'],
  ['right-motor', 'negative', 'right-fet', 'drain'],
  ['right-fet', 'source', 'battery', 'BAT-'],
  ['uno', 'd6', 'right-fet', 'gate'],
  ['right-flyback', 'anode', 'right-motor', 'negative'],
  ['right-flyback', 'cathode', 'right-motor', 'positive'],
];

export function createDefaultRoboticsProject(program?: RoboticsPresetProgram): RoboticsProject {
  let circuit: SchematicDocument = {
    schemaVersion: 4,
    components: [],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
  for (const [id, componentTypeId, x, y] of PRESET_COMPONENTS) {
    const entry = productionCatalogEntry(componentTypeId);
    if (!entry?.enabled || !entry.simulationSupported)
      throw new Error(`Компонент «${componentTypeId}» недоступен в общем каталоге электроники.`);
    circuit = addComponentToDocument(circuit, componentTypeId, { x, y }, id).document;
  }
  circuit = {
    ...circuit,
    components: circuit.components.map((component) =>
      component.id === 'uno'
        ? {
            ...component,
            stateProperties: {
              ...component.stateProperties,
              arduinoCodeMode: program?.mode ?? 'text',
              arduinoSource: program?.source ?? ROBOTICS_ARDUINO_SOURCE,
              ...(program
                ? {
                    arduinoWorkspace: program.workspaceJson,
                    arduinoInputPins: program.inputPins,
                  }
                : {}),
              arduinoSerialOpen: !program,
              arduinoBaudRate: 9600,
            },
          }
        : component,
    ),
    connections: PRESET_CONNECTIONS.map(([fromId, fromTerminal, toId, toTerminal], index) => ({
      id: `rover-wire-${index + 1}`,
      from: { componentId: fromId, terminal: fromTerminal },
      to: { componentId: toId, terminal: toTerminal },
    })),
  };
  const world = createRoboticsWorldDocument();
  const project = withRoboticsWorld(
    { schemaVersion: 2, title: 'Первый робот ASA Lab', circuit, world },
    world,
  );
  const parsed = parseElectronicsEngineDocument(project.circuit);
  if (!parsed.ok) throw new Error(parsed.message);
  return project;
}

/** Bindings constrain assembly only; the shared engine owns electrical validity and program support. */
export function validateRoboticsBindings(project: RoboticsProject): string | null {
  const bindings = project.world.bindings;
  if (new Set(Object.values(bindings)).size !== 4)
    return 'Arduino, два мотора и датчик должны быть разными компонентами.';
  const expected = [
    [bindings.boardId, 'arduino-uno', 'Arduino Uno'],
    [bindings.leftMotorId, 'gearmotor', 'Левый мотор'],
    [bindings.rightMotorId, 'gearmotor', 'Правый мотор'],
    [bindings.distanceSensorId, 'ultrasonic-hc-sr04', 'Датчик HC-SR04'],
  ] as const;
  for (const [id, componentTypeId, label] of expected) {
    const component = project.circuit.components.find((candidate) => candidate.id === id);
    if (!component) return `${label}: связанный компонент «${id}» отсутствует на схеме.`;
    if (component.componentTypeId !== componentTypeId)
      return `${label}: компонент «${id}» имеет неподдерживаемый тип.`;
    const entry = productionCatalogEntry(componentTypeId);
    if (!entry?.enabled || !entry.simulationSupported)
      return `${label}: компонент недоступен в общем каталоге электроники.`;
  }
  return null;
}

/** Explicit stopped field edits also set the sensor's initial environment, never runtime samples. */
export function withRoboticsWorld(
  project: RoboticsProject,
  nextWorld: RoboticsWorldDocument,
): RoboticsProject {
  const parsed = parseRoboticsWorldDocument(nextWorld);
  if (!parsed.ok) throw new Error(parsed.message);
  const world = parsed.world;
  const sonar = project.circuit.components.find(
    (component) => component.id === world.bindings.distanceSensorId,
  );
  if (sonar?.componentTypeId !== 'ultrasonic-hc-sr04')
    throw new Error('Для поля нужен связанный датчик HC-SR04 на схеме.');
  const measurement = measureRoboticsDistance(world, world.initialPose);
  if (measurement.status !== 'ok') throw new Error(measurement.message);
  return {
    ...project,
    world,
    circuit: {
      ...project.circuit,
      components: project.circuit.components.map((component) =>
        component.id === sonar.id
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                distanceMeters: measurement.distanceMeters,
              },
            }
          : component,
      ),
    },
  };
}

export function parseRoboticsProject(
  value: unknown,
):
  | { readonly ok: true; readonly project: RoboticsProject }
  | { readonly ok: false; readonly message: string } {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('Некорректный локальный проект робототехники.');
    const source = value as Record<string, unknown>;
    if (source.schemaVersion !== 1 && source.schemaVersion !== 2)
      throw new Error('Эта версия проекта робототехники не поддерживается.');
    if (source.schemaVersion === 2) {
      const scene = source.world as Partial<RoboticsWorldDocument> | null;
      if (
        !scene ||
        scene.physicsProfile !== 'kinematic-rover-discs-v1' ||
        !Array.isArray(scene.field?.balls) ||
        !Array.isArray(scene.field?.floorMarks)
      )
        throw new Error('Проект повреждён: отсутствуют обязательные данные поля.');
    }
    if (typeof source.title !== 'string' || source.title.trim() === '' || source.title.length > 80)
      throw new Error('Название проекта должно содержать от 1 до 80 символов.');
    const world = parseRoboticsWorldDocument(source.world);
    if (!world.ok) return world;
    const electrical = parseElectronicsEngineDocument(source.circuit);
    if (!electrical.ok) return { ok: false, message: `Схема: ${electrical.message}` };
    // The canonical parser validates the shape; a fresh deep clone makes it a mutable Web document.
    const circuit = structuredClone(electrical.document) as SchematicDocument;
    circuit.simulation = { ...circuit.simulation, running: false };
    return {
      ok: true,
      project: { schemaVersion: 2, title: source.title, circuit, world: world.world },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Не удалось прочитать проект робототехники.',
    };
  }
}
