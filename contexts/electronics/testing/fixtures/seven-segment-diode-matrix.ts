import {
  parseElectronicsDocument,
  type ElectronicsDocument,
  type SchematicComponent,
} from '../../domain/document.js';
import { SEVEN_SEGMENT_TERMINALS } from '../../domain/led-model.js';

const DIODE_ROUTES = [
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
];

/** Complete decimal diode matrix: no sketch, decoder adapter or injected display state. */
export function sevenSegmentDiodeMatrix(pressed: readonly number[] = []): ElectronicsDocument {
  const components: SchematicComponent[] = [
    {
      id: 'battery',
      kind: 'source',
      componentTypeId: 'battery-holder-aa-2',
      variantId: 'battery-holder-aa-2',
      value: 3,
      position: { x: 60, y: 540 },
      pinIds: ['BAT+', 'BAT-'],
      stateProperties: { cells: 2 },
    },
    {
      id: 'display',
      kind: 'seven-segment',
      componentTypeId: 'seven-segment-display',
      variantId: 'seven-segment-display',
      value: 0,
      position: { x: 80, y: 70 },
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
    },
  ];
  const connections: ElectronicsDocument['connections'][number][] = [];
  const connect = (
    id: string,
    componentId: string,
    terminal: string,
    target: string,
    targetTerminal: string,
  ) => {
    connections.push({
      id,
      from: { componentId, terminal },
      to: { componentId: target, terminal: targetTerminal },
      color: '#e3212b',
    });
  };
  connect('common-ground', 'display', 'top-3', 'battery', 'BAT-');
  for (const [row, segment] of [...'abcdefg'].entries()) {
    const id = `bus-${segment}`;
    components.push({
      id,
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      value: 100,
      position: { x: 210, y: 80 + row * 80 },
      pinIds: ['lead-1', 'lead-2'],
    });
    connect(
      `segment-${segment}`,
      id,
      'lead-2',
      'display',
      SEVEN_SEGMENT_TERMINALS[segment as keyof typeof SEVEN_SEGMENT_TERMINALS],
    );
  }
  DIODE_ROUTES.forEach((segments, digit) => {
    const id = `button-${digit}`,
      x = 340 + digit * 180;
    components.push({
      id,
      name: String(digit),
      kind: 'button',
      componentTypeId: 'button-tactile-6mm',
      value: 0,
      position: { x, y: 700 },
      state: pressed.includes(digit),
      pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
      internalConnections: [
        ['SW-A1', 'SW-A2'],
        ['SW-B1', 'SW-B2'],
      ],
    });
    connect(`supply-${digit}`, 'battery', 'BAT+', id, 'SW-A1');
    for (const segment of segments) {
      const suffix = `${digit}-${segment}`,
        row = 'abcdefg'.indexOf(segment),
        y = 80 + row * 80;
      components.push(
        {
          id: `diode-${suffix}`,
          kind: 'diode',
          componentTypeId: 'diode-do35',
          value: 0.7,
          position: { x, y },
          pinIds: ['anode', 'cathode'],
        },
        {
          id: `resistor-${suffix}`,
          kind: 'resistor',
          componentTypeId: 'resistor-axial',
          value: 220,
          position: { x: x + 65, y },
          pinIds: ['lead-1', 'lead-2'],
        },
      );
      connect(`button-diode-${suffix}`, id, 'SW-B1', `diode-${suffix}`, 'anode');
      connect(
        `diode-resistor-${suffix}`,
        `diode-${suffix}`,
        'cathode',
        `resistor-${suffix}`,
        'lead-1',
      );
      connect(`resistor-bus-${suffix}`, `resistor-${suffix}`, 'lead-2', `bus-${segment}`, 'lead-1');
    }
  });
  // Include the ordinary catalog editing defaults so reopen is not mistaken
  // for a topology edit when the production editor hydrates these properties.
  const savedComponents = components.map((component) => ({
    ...component,
    variantId: component.componentTypeId,
    stateProperties:
      component.stateProperties ??
      (component.kind === 'resistor'
        ? { tolerancePercent: 5, resistanceUnit: 'Ω', powerRatingWatt: 0.25 }
        : component.kind === 'button'
          ? { contactState: component.state ? 'pressed' : 'released' }
          : {}),
  }));
  const parsed = parseElectronicsDocument({
    schemaVersion: 4,
    components: savedComponents,
    connections,
    viewport: { x: 0, y: 0, zoom: 0.6 },
    simulation: { running: false, maxIterations: 24 },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
