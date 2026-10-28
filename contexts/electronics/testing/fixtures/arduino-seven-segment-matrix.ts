import {
  parseElectronicsDocument,
  type ElectronicsDocument,
  type SchematicComponent,
} from '../../domain/document.js';
import { SEVEN_SEGMENT_TERMINALS } from '../../domain/led-model.js';

export const MATRIX_SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] as const;
export const MATRIX_DIGITS = ['bc', 'abdeg', 'abcdg', 'bcfg'] as const;
export type MatrixCommand = { pin: number; high: boolean } | { waitMs: number };

/** Actual shared buses and NPN common-cathode selection; no serial display adapter. */
export function matrixCommands(count: number): MatrixCommand[] {
  const commands: MatrixCommand[] = [];
  for (let digit = 0; digit < count; digit++) {
    for (let index = 0; index < count; index++) commands.push({ pin: 10 + index, high: false });
    MATRIX_SEGMENTS.forEach((segment, index) =>
      commands.push({ pin: 2 + index, high: MATRIX_DIGITS[digit]!.includes(segment) }),
    );
    commands.push({ pin: 10 + digit, high: true }, { waitMs: 2 }, { pin: 10 + digit, high: false });
  }
  return commands;
}

export function matrixLinearSource(count: number): string {
  const pins = Array.from({ length: 8 + count }, (_, index) => index + 2);
  const setup = pins.map((pin) => `pinMode(${pin}, OUTPUT);`).join('\n');
  const loop = matrixCommands(count)
    .map((command) =>
      'waitMs' in command
        ? `delay(${command.waitMs});`
        : `digitalWrite(${command.pin}, ${command.high ? 'HIGH' : 'LOW'});`,
    )
    .join('\n');
  return `void setup(){\n${setup}\n}\nvoid loop(){\n${loop}\n}`;
}

export const FUNCTION_PROBE_SOURCE =
  'void showDigit(int value){digitalWrite(2,value);}\nvoid setup(){pinMode(2,OUTPUT);}\nvoid loop(){showDigit(HIGH);delay(2);}';

export function arduinoSevenSegmentMatrix(
  count: 1 | 2 | 3 | 4,
  source = matrixLinearSource(count),
): ElectronicsDocument {
  const components: SchematicComponent[] = [
    {
      id: 'uno',
      kind: 'visual',
      componentTypeId: 'arduino-uno',
      value: 5,
      position: { x: 30, y: 20 },
      pinIds: [
        ...Array.from({ length: 12 }, (_, index) => `d${index + 2}`),
        'power-gnd-1',
        'power-5v',
        'power-3v3',
      ],
      stateProperties: { arduinoSource: source },
    },
  ];
  const connections: ElectronicsDocument['connections'][number][] = [];
  const connect = (
    id: string,
    componentId: string,
    terminal: string,
    targetId: string,
    targetTerminal: string,
  ) =>
    connections.push({
      id,
      from: { componentId, terminal },
      to: { componentId: targetId, terminal: targetTerminal },
    });
  MATRIX_SEGMENTS.forEach((segment, index) => {
    components.push({
      id: `r-${segment}`,
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      value: 2200,
      position: { x: 400 + index * 60, y: 320 },
      pinIds: ['lead-1', 'lead-2'],
    });
    connect(`gpio-${segment}`, 'uno', `d${index + 2}`, `r-${segment}`, 'lead-1');
  });
  for (let digit = 0; digit < count; digit++) {
    const displayId = `display-${digit}`,
      driverId = `driver-${digit}`,
      resistorId = `base-${digit}`;
    components.push({
      id: displayId,
      kind: 'seven-segment',
      componentTypeId: 'seven-segment-display',
      variantId: 'seven-segment-display',
      value: 0,
      position: { x: 440 + digit * 150, y: 20 },
      pinIds: [
        'top-1',
        'top-2',
        'top-3',
        'top-4',
        'top-5',
        'bottom-1',
        'bottom-2',
        'bottom-3',
        'bottom-4',
        'bottom-5',
      ],
      internalConnections: [['top-3', 'bottom-3']],
      stateProperties: { commonMode: 'common-cathode', segmentColor: 'red' },
    });
    components.push({
      id: driverId,
      kind: 'transistor',
      componentTypeId: 'transistor-npn',
      variantId: 'transistor-npn',
      value: 100,
      position: { x: 440 + digit * 150, y: 230 },
      pinIds: ['base', 'collector', 'emitter'],
    });
    components.push({
      id: resistorId,
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      value: 1000,
      position: { x: 440 + digit * 150, y: 430 },
      pinIds: ['lead-1', 'lead-2'],
    });
    MATRIX_SEGMENTS.forEach((segment) =>
      connect(
        `segment-${digit}-${segment}`,
        `r-${segment}`,
        'lead-2',
        displayId,
        SEVEN_SEGMENT_TERMINALS[segment],
      ),
    );
    connect(`common-${digit}`, displayId, 'top-3', driverId, 'collector');
    connect(`ground-${digit}`, driverId, 'emitter', 'uno', 'power-gnd-1');
    connect(`base-pin-${digit}`, 'uno', `d${10 + digit}`, resistorId, 'lead-1');
    connect(`base-driver-${digit}`, resistorId, 'lead-2', driverId, 'base');
  }
  const parsed = parseElectronicsDocument({
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

/** Safe direct GPIO common sink: 2.2k limits all seven lit segments below 10mA total. */
export function gpioCommonMatrix(count: 1 | 4): ElectronicsDocument {
  const npn = arduinoSevenSegmentMatrix(count);
  const setup = [
    ...MATRIX_SEGMENTS.map((_, index) => `pinMode(${2 + index}, OUTPUT);`),
    ...Array.from(
      { length: count },
      (_, index) => `digitalWrite(${10 + index}, LOW);pinMode(${10 + index}, INPUT);`,
    ),
  ].join('\n');
  const lines: string[] = [];
  for (let digit = 0; digit < count; digit++) {
    for (let index = 0; index < count; index++) lines.push(`pinMode(${10 + index}, INPUT);`);
    MATRIX_SEGMENTS.forEach((segment, index) =>
      lines.push(
        `digitalWrite(${2 + index}, ${MATRIX_DIGITS[digit]!.includes(segment) ? 'HIGH' : 'LOW'});`,
      ),
    );
    lines.push(`pinMode(${10 + digit}, OUTPUT);delay(2);pinMode(${10 + digit}, INPUT);`);
  }
  const components = npn.components
    .filter((component) => !component.id.startsWith('driver-') && !component.id.startsWith('base-'))
    .map((component) =>
      component.id === 'uno'
        ? {
            ...component,
            stateProperties: {
              arduinoSource: `void setup(){${setup}}void loop(){${lines.join('\n')}}`,
            },
          }
        : component,
    );
  const connections = npn.connections.filter(
    (connection) =>
      ![connection.from.componentId, connection.to.componentId].some(
        (id) => id.startsWith('driver-') || id.startsWith('base-'),
      ),
  );
  for (let digit = 0; digit < count; digit++)
    connections.push({
      id: `gpio-common-${digit}`,
      from: { componentId: `display-${digit}`, terminal: 'top-3' },
      to: { componentId: 'uno', terminal: `d${10 + digit}` },
    });
  const parsed = parseElectronicsDocument({ ...npn, components, connections });
  if (!parsed.ok) throw Error(parsed.message);
  return parsed.document;
}

export function outputCommonCommands(count: number): MatrixCommand[] {
  return matrixCommands(count).map((command) =>
    'pin' in command && command.pin >= 10 ? { ...command, high: !command.high } : command,
  );
}

export function outputCommonMatrix(count: 1 | 4, source?: string): ElectronicsDocument {
  const document = gpioCommonMatrix(count);
  const setup = Array.from(
    { length: 8 + count },
    (_, index) => `pinMode(${2 + index}, OUTPUT);`,
  ).join('\n');
  const loop = outputCommonCommands(count)
    .map((command) =>
      'waitMs' in command
        ? `delay(${command.waitMs});`
        : `digitalWrite(${command.pin}, ${command.high ? 'HIGH' : 'LOW'});`,
    )
    .join('\n');
  return {
    ...document,
    components: document.components.map((component) =>
      component.id === 'uno'
        ? {
            ...component,
            stateProperties: {
              arduinoSource: source ?? `void setup(){${setup}}void loop(){${loop}}`,
            },
          }
        : component,
    ),
  };
}
