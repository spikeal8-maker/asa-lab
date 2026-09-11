import type {
  ComponentKind,
  ElectronicsDocument,
  SchematicComponent,
  Terminal,
} from '../domain/document.js';
import { advanceArduinoCircuitClock } from '../domain/arduino-circuit-scheduler.js';
import { analyseCircuit } from '../domain/simulation.js';
import { simulationInputDigest } from '../domain/simulation-input-digest.js';

export const ELECTRONICS_BENCHMARK_CORPUS_VERSION = 'asa-electronics-opt0-v1';
export type ElectronicsBenchmarkTier = 'micro' | 'medium' | 'stress';
export type ElectronicsBenchmarkOperation = 'analyse' | 'digest' | 'arduino-clock';

export interface ElectronicsBenchmarkCase {
  readonly id: string;
  readonly tier: ElectronicsBenchmarkTier;
  readonly category: string;
  readonly operation: ElectronicsBenchmarkOperation;
  readonly expectedStatus: string;
  readonly run: () => unknown;
}

function component(
  id: string,
  kind: ComponentKind,
  value: number,
  options: Partial<SchematicComponent> = {},
): SchematicComponent {
  return { id, kind, value, position: { x: 0, y: 0 }, ...options };
}
function connect(
  id: string,
  from: string,
  fromTerminal: Terminal,
  to: string,
  toTerminal: Terminal,
) {
  return {
    id,
    from: { componentId: from, terminal: fromTerminal },
    to: { componentId: to, terminal: toTerminal },
    color: '#149447',
    vertices: [],
  };
}

function document(
  components: readonly SchematicComponent[],
  connections: ElectronicsDocument['connections'],
  maxIterations = 64,
): ElectronicsDocument {
  return {
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations },
  };
}

function seriesResistors(count: number): ElectronicsDocument {
  const resistors = Array.from({ length: count }, (_, index) =>
    component(`r${index}`, 'resistor', 100 + index),
  );
  const connections: ElectronicsDocument['connections'] = [
    connect('w-source', 'source', 'a', resistors[0]!.id, 'a'),
  ];
  for (let index = 0; index < resistors.length; index += 1) {
    const current = resistors[index]!;
    const next = resistors[index + 1];
    connections.push(
      next
        ? connect(`w${index}`, current.id, 'b', next.id, 'a')
        : connect(`w${index}`, current.id, 'b', 'source', 'b'),
    );
  }
  return document([component('source', 'source', 9), ...resistors], connections);
}

function parallelResistors(count: number): ElectronicsDocument {
  const resistors = Array.from({ length: count }, (_, index) =>
    component(`r${index}`, 'resistor', 220 + index * 10),
  );
  const connections: ElectronicsDocument['connections'] = [];
  for (const resistor of resistors) {
    connections.push(
      connect(`p-${resistor.id}`, 'source', 'a', resistor.id, 'a'),
      connect(`n-${resistor.id}`, resistor.id, 'b', 'source', 'b'),
    );
  }
  return document([component('source', 'source', 5), ...resistors], connections);
}
function ledCircuit(seriesOhm: number | null): ElectronicsDocument {
  const parts: SchematicComponent[] = [
    component('source', 'source', 5),
    component('led', 'led', 2),
  ];
  const connections: ElectronicsDocument['connections'] = [];
  if (seriesOhm === null) {
    connections.push(
      connect('p', 'source', 'a', 'led', 'a'),
      connect('n', 'led', 'b', 'source', 'b'),
    );
  } else {
    parts.push(component('r', 'resistor', seriesOhm));
    connections.push(
      connect('p', 'source', 'a', 'r', 'a'),
      connect('mid', 'r', 'b', 'led', 'a'),
      connect('n', 'led', 'b', 'source', 'b'),
    );
  }
  return document(parts, connections);
}

function rgbCircuit(): ElectronicsDocument {
  const rgb = component('rgb', 'rgb-led', 0, {
    componentTypeId: 'rgb-led',
    pinIds: ['red', 'common', 'green', 'blue'],
    stateProperties: { commonMode: 'common-cathode' },
  });
  const resistors = ['red', 'green', 'blue'].map((channel) =>
    component(`r-${channel}`, 'resistor', 220),
  );
  const connections: ElectronicsDocument['connections'] = [];
  for (const channel of ['red', 'green', 'blue'] as const) {
    connections.push(
      connect(`p-${channel}`, 'source', 'a', `r-${channel}`, 'a'),
      connect(`c-${channel}`, `r-${channel}`, 'b', 'rgb', channel),
    );
  }
  connections.push(connect('common', 'rgb', 'common', 'source', 'b'));
  return document([component('source', 'source', 5), rgb, ...resistors], connections);
}
function sevenSegmentCircuit(): ElectronicsDocument {
  const display = component('display', 'seven-segment', 0, {
    componentTypeId: 'seven-segment-display',
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
    stateProperties: { commonMode: 'common-cathode' },
  });
  const pins: Readonly<Record<string, Terminal>> = {
    a: 'top-4',
    b: 'top-5',
    c: 'bottom-4',
    d: 'bottom-2',
    e: 'bottom-1',
    f: 'top-2',
    g: 'top-1',
    dp: 'bottom-5',
  };
  const components: SchematicComponent[] = [component('source', 'source', 3), display];
  const connections: ElectronicsDocument['connections'] = [];
  for (const [segment, pin] of Object.entries(pins)) {
    components.push(component(`r-${segment}`, 'resistor', 220));
    connections.push(
      connect(`p-${segment}`, 'source', 'a', `r-${segment}`, 'a'),
      connect(`s-${segment}`, `r-${segment}`, 'b', 'display', pin),
    );
  }
  connections.push(connect('common', 'display', 'bottom-3', 'source', 'b'));
  return document(components, connections);
}

function potentiometerCircuit(position = 0.5): ElectronicsDocument {
  const pot = component('pot', 'potentiometer', 10_000, { wiperPosition: position });
  return document(
    [component('source', 'source', 5), pot, component('load', 'resistor', 10_000)],
    [
      connect('p', 'source', 'a', 'pot', 'a'),
      connect('n', 'pot', 'b', 'source', 'b'),
      connect('w', 'pot', 'wiper', 'load', 'a'),
      connect('g', 'load', 'b', 'source', 'b'),
    ],
  );
}
function photoresistorCircuit(illumination: number): ElectronicsDocument {
  return document(
    [
      component('source', 'source', 5),
      component('ldr', 'photoresistor', 0, { stateProperties: { illumination } }),
      component('load', 'resistor', 10_000),
    ],
    [
      connect('p', 'source', 'a', 'ldr', 'a'),
      connect('mid', 'ldr', 'b', 'load', 'a'),
      connect('n', 'load', 'b', 'source', 'b'),
    ],
  );
}

function tmp36Circuit(temperatureCelsius = 25): ElectronicsDocument {
  return document(
    [
      component('source', 'source', 5),
      component('tmp', 'visual', 0, {
        componentTypeId: 'temperature-sensor',
        pinIds: ['pin-1', 'pin-2', 'pin-3'],
        stateProperties: { temperatureCelsius },
      }),
      component('load', 'resistor', 10_000_000),
    ],
    [
      connect('vcc', 'source', 'a', 'tmp', 'pin-1'),
      connect('gnd', 'source', 'b', 'tmp', 'pin-3'),
      connect('out', 'tmp', 'pin-2', 'load', 'a'),
      connect('return', 'load', 'b', 'tmp', 'pin-3'),
    ],
  );
}
function soilCircuit(moisturePercent = 50): ElectronicsDocument {
  return document(
    [
      component('source', 'source', 5),
      component('soil', 'visual', 0, {
        componentTypeId: 'soil-moisture-sensor',
        pinIds: ['vcc', 'gnd', 'signal'],
        stateProperties: { moisturePercent },
      }),
      component('load', 'resistor', 10_000_000),
    ],
    [
      connect('vcc', 'source', 'a', 'soil', 'vcc'),
      connect('gnd', 'source', 'b', 'soil', 'gnd'),
      connect('out', 'soil', 'signal', 'load', 'a'),
      connect('return', 'load', 'b', 'soil', 'gnd'),
    ],
  );
}

function regulatedSupplyCircuit(currentLimitAmp: number, loadOhm: number): ElectronicsDocument {
  const supply = component('supply', 'source', 5, {
    componentTypeId: 'regulated-power-supply',
    pinIds: ['positive', 'negative'],
    stateProperties: {
      voltageSetpointVolt: 5,
      currentLimitAmp,
      outputEnabled: true,
      outputResistanceOhm: 0.05,
    },
  });
  const load = component('load', 'resistor', loadOhm, {
    componentTypeId: 'resistor-axial',
    pinIds: ['lead-1', 'lead-2'],
  });
  return document(
    [supply, load],
    [
      connect('p', 'supply', 'positive', 'load', 'lead-1'),
      connect('n', 'load', 'lead-2', 'supply', 'negative'),
    ],
  );
}
function capacitorCircuit(): ElectronicsDocument {
  const capacitor = component('cap', 'visual', 100, {
    componentTypeId: 'electrolytic-capacitor',
    pinIds: ['positive', 'negative'],
    stateProperties: { voltageRatingVolt: 25, initialVoltageVolt: 0 },
  });
  return document(
    [component('source', 'source', 5), component('r', 'resistor', 1_000), capacitor],
    [
      connect('p', 'source', 'a', 'r', 'a'),
      connect('mid', 'r', 'b', 'cap', 'positive'),
      connect('n', 'cap', 'negative', 'source', 'b'),
    ],
  );
}

function motorCircuit(
  componentTypeId: 'dc-motor' | 'gearmotor' | 'vibration-motor',
): ElectronicsDocument {
  const properties =
    componentTypeId === 'gearmotor'
      ? { motorAssemblyProfileId: 'adafruit-3777-tt-48to1' }
      : componentTypeId === 'vibration-motor'
        ? { motorAssemblyProfileId: 'precision-microdrives-310-101-3v' }
        : {};
  const motor = component('motor', 'visual', 0, {
    componentTypeId,
    pinIds: ['negative', 'positive'],
    stateProperties: properties,
  });
  const voltage = componentTypeId === 'vibration-motor' ? 3 : 6;
  return document(
    [component('source', 'source', voltage), motor],
    [
      connect('p', 'source', 'a', 'motor', 'positive'),
      connect('n', 'motor', 'negative', 'source', 'b'),
    ],
  );
}
function generatorScopeCircuit(): ElectronicsDocument {
  const generator = component('generator', 'source', 1_000, {
    componentTypeId: 'signal-generator',
    pinIds: ['signal', 'ground'],
    state: true,
    stateProperties: {
      waveform: 'sine',
      frequencyHz: 1_000,
      amplitudeVpp: 5,
      dcOffsetVolt: 0,
      outputEnabled: true,
      outputResistanceOhm: 50,
      maxContinuousCurrentAmp: 0.1,
    },
  });
  const scope = component('scope', 'visual', 1, {
    componentTypeId: 'oscilloscope',
    pinIds: ['signal', 'ground'],
    state: true,
    stateProperties: {
      voltsPerDivision: 1,
      timePerDivisionMs: 1,
      triggerLevelVolt: 0,
      displayEnabled: true,
      coupling: 'DC',
    },
  });
  return document(
    [generator, scope],
    [
      connect('signal', 'generator', 'signal', 'scope', 'signal'),
      connect('ground', 'generator', 'ground', 'scope', 'ground'),
    ],
  );
}

function multimeterVoltageCircuit(): ElectronicsDocument {
  const meter = component('meter', 'visual', 0, {
    componentTypeId: 'multimeter',
    pinIds: ['com', 'v-ohm-ma'],
    stateProperties: { measurementMode: 'dc-voltage', meterRange: 'auto' },
  });
  return document(
    [component('source', 'source', 9), meter],
    [
      connect('red', 'source', 'a', 'meter', 'v-ohm-ma'),
      connect('black', 'meter', 'com', 'source', 'b'),
    ],
  );
}

function unsupportedCircuit(): ElectronicsDocument {
  return document(
    [
      component('source', 'source', 5),
      component('future', 'visual', 0, { componentTypeId: 'future-device' }),
    ],
    [],
  );
}
function arduinoBoard(id: string, source: string): SchematicComponent {
  return component(id, 'visual', 5, {
    componentTypeId: 'arduino-uno',
    pinIds: [
      'd2',
      'd3',
      'd7',
      'd8',
      'd13',
      'a0',
      'a5',
      'power-5v',
      'power-3v3',
      'power-gnd-1',
      'gnd-top',
    ],
    stateProperties: { arduinoSource: source },
  });
}

function arduinoBlinkCircuit(): ElectronicsDocument {
  return document(
    [
      arduinoBoard(
        'uno',
        'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);digitalWrite(13,LOW);delay(1);}',
      ),
    ],
    [],
  );
}

function arduinoGpioCircuit(): ElectronicsDocument {
  return document(
    [
      arduinoBoard(
        'uno',
        'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delayMicroseconds(10);digitalWrite(13,LOW);delayMicroseconds(10);}',
      ),
      component('load', 'resistor', 1_000),
    ],
    [connect('p', 'uno', 'd13', 'load', 'a'), connect('n', 'load', 'b', 'uno', 'power-gnd-1')],
  );
}

function arduinoAdcCircuit(): ElectronicsDocument {
  return document(
    [
      arduinoBoard(
        'uno',
        'int reading;void setup(){}void loop(){reading=analogRead(A0);delayMicroseconds(10);}',
      ),
      component('top', 'resistor', 1_000),
      component('bottom', 'resistor', 1_000),
    ],
    [
      connect('p', 'uno', 'power-5v', 'top', 'a'),
      connect('mid', 'top', 'b', 'bottom', 'a'),
      connect('adc', 'bottom', 'a', 'uno', 'a0'),
      connect('n', 'bottom', 'b', 'uno', 'power-gnd-1'),
    ],
  );
}
function arduinoTwoBoardCircuit(): ElectronicsDocument {
  return document(
    [
      arduinoBoard(
        'a',
        'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delayMicroseconds(20);}',
      ),
      arduinoBoard(
        'b',
        'int level;void setup(){pinMode(2,INPUT);}void loop(){level=digitalRead(2);delayMicroseconds(20);}',
      ),
    ],
    [
      connect('signal', 'a', 'd13', 'b', 'd2'),
      connect('ground', 'a', 'power-gnd-1', 'b', 'power-gnd-1'),
    ],
  );
}

function runClock(document: ElectronicsDocument, targetMicroseconds: number, budget = 256) {
  let previous = undefined;
  const events = [] as unknown[];
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const result = advanceArduinoCircuitClock(document, targetMicroseconds, previous, {
      maxClockEvents: budget,
    });
    events.push(...result.events);
    if (result.executionStatus !== 'yielded') return { ...result, events };
    previous = result.state ?? undefined;
  }
  throw new Error(`Arduino scheduler did not reach ${targetMicroseconds} us`);
}

function analyseCase(
  id: string,
  tier: ElectronicsBenchmarkTier,
  category: string,
  circuit: ElectronicsDocument,
  simulationTimeMs = 0,
  expectedStatus = 'solved',
): ElectronicsBenchmarkCase {
  return {
    id,
    tier,
    category,
    operation: 'analyse',
    expectedStatus,
    run: () => analyseCircuit(circuit, { simulationTimeMs }),
  };
}
function digestCase(
  id: string,
  tier: ElectronicsBenchmarkTier,
  circuit: ElectronicsDocument,
): ElectronicsBenchmarkCase {
  return {
    id,
    tier,
    category: 'serialization',
    operation: 'digest',
    expectedStatus: 'digest',
    run: () => simulationInputDigest(circuit),
  };
}

function clockCase(
  id: string,
  tier: ElectronicsBenchmarkTier,
  category: string,
  circuit: ElectronicsDocument,
  targetMicroseconds: number,
  budget = 256,
): ElectronicsBenchmarkCase {
  return {
    id,
    tier,
    category,
    operation: 'arduino-clock',
    expectedStatus: 'ready',
    run: () => runClock(circuit, targetMicroseconds, budget),
  };
}

const series1 = seriesResistors(1);
const series10 = seriesResistors(10);
const series50 = seriesResistors(50);
const parallel4 = parallelResistors(4);
const parallel20 = parallelResistors(20);
const capacitor = capacitorCircuit();
const dcMotor = motorCircuit('dc-motor');
const gearmotor = motorCircuit('gearmotor');
const vibrationMotor = motorCircuit('vibration-motor');
export const ELECTRONICS_BENCHMARK_CORPUS: readonly ElectronicsBenchmarkCase[] = [
  digestCase('digest-series-1', 'micro', series1),
  digestCase('digest-series-50', 'stress', series50),
  analyseCase('dc-series-1', 'micro', 'linear-dc', series1),
  analyseCase('dc-series-10', 'medium', 'linear-dc', series10),
  analyseCase('dc-series-50', 'stress', 'linear-dc', series50),
  analyseCase('dc-parallel-4', 'medium', 'linear-dc', parallel4),
  analyseCase('dc-parallel-20', 'stress', 'linear-dc', parallel20),
  analyseCase('dc-led-series', 'micro', 'nonlinear-dc', ledCircuit(220)),
  analyseCase('dc-led-overcurrent', 'micro', 'nonlinear-dc', ledCircuit(null)),
  analyseCase('dc-rgb-led', 'medium', 'nonlinear-dc', rgbCircuit()),
  analyseCase('dc-seven-segment', 'medium', 'nonlinear-dc', sevenSegmentCircuit()),
  analyseCase('dc-potentiometer-25', 'micro', 'linear-dc', potentiometerCircuit(0.25)),
  analyseCase('dc-potentiometer-75', 'micro', 'linear-dc', potentiometerCircuit(0.75)),
  analyseCase('dc-photoresistor-dark', 'micro', 'sensor', photoresistorCircuit(0)),
  analyseCase('dc-photoresistor-bright', 'micro', 'sensor', photoresistorCircuit(1)),
  analyseCase('dc-tmp36-25c', 'medium', 'sensor', tmp36Circuit(25)),
  analyseCase('dc-tmp36-100c', 'medium', 'sensor', tmp36Circuit(100)),
  analyseCase('dc-soil-0', 'medium', 'sensor', soilCircuit(0)),
  analyseCase('dc-soil-50', 'medium', 'sensor', soilCircuit(50)),
  analyseCase('dc-soil-100', 'medium', 'sensor', soilCircuit(100)),
  analyseCase('dc-bench-supply-cv', 'medium', 'source', regulatedSupplyCircuit(0.2, 100)),
  analyseCase('dc-bench-supply-cc', 'medium', 'source', regulatedSupplyCircuit(0.1, 10)),
  analyseCase('transient-capacitor-1ms', 'medium', 'transient', capacitor, 1),
  analyseCase('transient-capacitor-100ms', 'medium', 'transient', capacitor, 100),
  analyseCase('transient-capacitor-5000ms', 'stress', 'transient', capacitor, 5_000),
  analyseCase('transient-dc-motor-10ms', 'medium', 'motor', dcMotor, 10),
  analyseCase('transient-dc-motor-1000ms', 'stress', 'motor', dcMotor, 1_000),
  analyseCase('transient-gearmotor-1000ms', 'stress', 'motor', gearmotor, 1_000),
  analyseCase('transient-vibration-motor-1000ms', 'stress', 'motor', vibrationMotor, 1_000),
  analyseCase('instrument-generator-scope', 'medium', 'instrument', generatorScopeCircuit(), 2.5),
  analyseCase('instrument-multimeter-voltage', 'micro', 'instrument', multimeterVoltageCircuit()),
  analyseCase(
    'unsupported-future-device',
    'micro',
    'safety',
    unsupportedCircuit(),
    0,
    'unsupported',
  ),
  analyseCase('arduino-blink-analyse-10ms', 'medium', 'arduino', arduinoBlinkCircuit(), 10),
  clockCase('arduino-gpio-clock-2000us', 'medium', 'arduino-clock', arduinoGpioCircuit(), 2_000),
  clockCase('arduino-adc-clock-3500us', 'medium', 'arduino-clock', arduinoAdcCircuit(), 3_500),
  clockCase(
    'arduino-two-board-clock-3500us',
    'stress',
    'arduino-clock',
    arduinoTwoBoardCircuit(),
    3_500,
  ),
  clockCase('arduino-gpio-small-budget', 'stress', 'arduino-clock', arduinoGpioCircuit(), 2_000, 7),
];
