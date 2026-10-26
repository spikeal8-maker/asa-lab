import {
  parseElectronicsDocument,
  type ElectronicsDocument,
  type SchematicComponent,
} from '../../domain/document.js';
import { SEVEN_SEGMENT_TERMINALS } from '../../domain/led-model.js';

/** Real raw ten-pin display; no serial-display adapter or guessed owner wiring. */
export const RAW_DISPLAY_SEGMENTS = Object.keys(SEVEN_SEGMENT_TERMINALS);
export const RAW_DISPLAY_PINS = [4, 6, 7, 8, 9, 10, 11, 12] as const;
export const OWNER_HIGH_WRITES = [...RAW_DISPLAY_PINS, 12];
export const RAW_DISPLAY_DIGITS = [
  'abcdef',
  'bc',
  'abdeg',
  'abcdg',
  'bcfg',
  'acdfg',
  'acdefg',
  'abc',
  'abcdefg',
  'abcdfg',
] as const;

export function rawDisplaySource(
  writes: readonly number[] = OWNER_HIGH_WRITES,
  active = 'abcdefgdp',
  commonAnode = false,
): string {
  const setup = [...new Set(writes)].map((pin) => `pinMode(${pin}, OUTPUT);`).join('\n');
  const loop = writes
    .map((pin) => {
      const segment = RAW_DISPLAY_SEGMENTS[(RAW_DISPLAY_PINS as readonly number[]).indexOf(pin)];
      const lit =
        segment !== undefined &&
        (segment === 'dp' ? active.includes('dp') : active.replace('dp', '').includes(segment));
      return `digitalWrite(${pin}, ${lit !== commonAnode ? 'HIGH' : 'LOW'});`;
    })
    .join('\n');
  return `void setup() {\n${setup}\n}\nvoid loop() {\n${loop}\n}`;
}

export function rawDisplayCircuit(
  options: {
    source?: string;
    active?: string;
    commonAnode?: boolean;
    resistanceOhm?: number;
    commonTerminal?: 'top-3' | 'bottom-3';
    legacyResistors?: boolean;
  } = {},
): ElectronicsDocument {
  const commonAnode = options.commonAnode ?? false;
  const components: SchematicComponent[] = [
    {
      id: 'uno',
      kind: 'visual',
      value: 5,
      position: { x: 0, y: 0 },
      componentTypeId: 'arduino-uno',
      pinIds: [
        ...RAW_DISPLAY_PINS.map((pin) => `d${pin}`),
        'd13',
        'power-gnd-1',
        'power-5v',
        'power-3v3',
      ],
      stateProperties: {
        arduinoSource:
          options.source ?? rawDisplaySource(OWNER_HIGH_WRITES, options.active, commonAnode),
      },
    },
    {
      id: 'display',
      kind: 'seven-segment',
      value: 0,
      position: { x: 0, y: 0 },
      componentTypeId: 'seven-segment-display',
      variantId: 'seven-segment-display',
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
      stateProperties: { commonMode: commonAnode ? 'common-anode' : 'common-cathode' },
    },
  ];
  const connections: ElectronicsDocument['connections'] = [];
  const connect = (
    id: string,
    componentId: string,
    terminal: string,
    toId: string,
    toTerminal: string,
  ) =>
    connections.push({
      id,
      from: { componentId, terminal },
      to: { componentId: toId, terminal: toTerminal },
    });
  Object.entries(SEVEN_SEGMENT_TERMINALS).forEach(([segment, terminal], index) => {
    const pin = `d${RAW_DISPLAY_PINS[index]}`;
    if (options.resistanceOhm === 0) {
      connect(`direct-${segment}`, 'uno', pin, 'display', terminal);
    } else {
      components.push({
        id: `r-${segment}`,
        kind: 'resistor',
        value: options.resistanceOhm ?? 330,
        position: { x: 0, y: 0 },
        ...(options.legacyResistors
          ? {}
          : { componentTypeId: 'resistor-axial', pinIds: ['lead-1', 'lead-2'] }),
      });
      connect(
        `pin-${segment}`,
        'uno',
        pin,
        `r-${segment}`,
        options.legacyResistors ? 'a' : 'lead-1',
      );
      connect(
        `segment-${segment}`,
        `r-${segment}`,
        options.legacyResistors ? 'b' : 'lead-2',
        'display',
        terminal,
      );
    }
  });
  connect(
    'common',
    'display',
    options.commonTerminal ?? 'top-3',
    'uno',
    commonAnode ? 'power-5v' : 'power-gnd-1',
  );
  const parsed = parseElectronicsDocument({ schemaVersion: 4, components, connections });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
