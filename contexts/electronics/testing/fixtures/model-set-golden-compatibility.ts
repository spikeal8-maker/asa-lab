import { simulationModelSetDigest } from '../../domain/simulation.js';

export const HC_SR04_V2_MODEL_SET_DIGEST =
  'sha256:9676af902ad2603b595c0fdfde8325c34a328da5e4fae1db608f75ffdc971fbc';
export const PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST =
  'sha256:85476b0f4fd6412285623a06c1d2cbf15508339b6e181d8ace5d9f952faa0788';
export const PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST =
  'sha256:e247ff2ce80032038d9017f919e1b96872d95fa8ec7280835463792baf8b25e2';
export const ULTRASONIC_OUTPUT_MODEL_SET_DIGEST =
  'sha256:9af371de8710606125dd42747862dc3efbab490d99ae3bc07ce2060ad091a1e3';
export const PRE_HC_SR04_V2_MODEL_SET_DIGEST =
  'sha256:fcb0f3241eef974a312c1fa1891b86aee92d5d3cd5a8e76475f53fcaa2b201d5';

/**
 * Comparison-only bridge to immutable goldens recorded before the HC-SR04 v2
 * registry revision. The reviewed ultrasonic output registry is pinned explicitly.
 * The thermal revision's changed DC observations have separate benchmark fingerprints.
 * Another registry revision requires new explicit review.
 * Only the exact metadata field is translated; opaque strings (including saved
 * runtime JSON), property order and all other values retain their existing bytes.
 */
export function serializePreHcSr04V2Golden(value: unknown): string {
  if (simulationModelSetDigest() !== ULTRASONIC_OUTPUT_MODEL_SET_DIGEST)
    throw new Error('Unreviewed model registry for pre-HC-SR04-v2 golden comparison.');
  // The benchmark's digest operation hashes the raw input-digest string.
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value, (key, entry: unknown) => {
    if (key !== 'modelSetDigest') return entry;
    if (entry !== ULTRASONIC_OUTPUT_MODEL_SET_DIGEST)
      throw new Error('Unreviewed modelSetDigest field in pre-HC-SR04-v2 golden comparison.');
    return PRE_HC_SR04_V2_MODEL_SET_DIGEST;
  });
  if (serialized === undefined) throw new TypeError('The golden result must be serializable.');
  return serialized;
}

/** Genuine pending runs captured before U01 on e792998fc418e2210a116051848d76571155efe1.
 * Capture SHA-256: 2798ffeb0eb58b5f83f57a865356a7b86494ecefc189c4e3e6969b9332cb5e07.
 * Explicit/absent document identities yielded identical continuations; the direct
 * scheduler state equals JSON.parse(publicState.continuation.serializedState).
 * Keep opaque state bytes unchanged: these are rejection fixtures, not upgrades.
 */
export const ULTRASONIC_U01_LEGACY_SAMPLES = [
  {
    kind: 'hc',
    document: {
      schemaVersion: 4,
      components: [
        {
          id: 'uno',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          electricalModelId: 'arduino-uno',
          electricalModelVersion: 1,
          modelProfileId: 'arduino-uno-r3',
          modelProfileVersion: 1,
          position: {
            x: 0,
            y: 0,
          },
          value: 5,
          stateProperties: {
            arduinoSource:
              'unsigned long duration=999; void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT);digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);delayMicroseconds(10);digitalWrite(13,LOW);duration=pulseIn(2,HIGH,30000);} void loop(){delay(100);}',
          },
          pinIds: ['d2', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        },
        {
          id: 'sensor',
          kind: 'visual',
          componentTypeId: 'ultrasonic-hc-sr04',
          electricalModelId: 'hc-sr04-distance-sensor',
          electricalModelVersion: 1,
          modelProfileId: 'hc-sr04-canonical-echo-v1',
          modelProfileVersion: 2,
          position: {
            x: 100,
            y: 0,
          },
          value: 0,
          stateProperties: {
            distanceMeters: 1,
          },
          pinIds: ['vcc', 'trigger', 'echo', 'gnd'],
        },
      ],
      connections: [
        {
          id: 'vcc',
          from: {
            componentId: 'uno',
            terminal: 'power-5v',
          },
          to: {
            componentId: 'sensor',
            terminal: 'vcc',
          },
        },
        {
          id: 'gnd',
          from: {
            componentId: 'uno',
            terminal: 'power-gnd-1',
          },
          to: {
            componentId: 'sensor',
            terminal: 'gnd',
          },
        },
        {
          id: 'trigger',
          from: {
            componentId: 'uno',
            terminal: 'd13',
          },
          to: {
            componentId: 'sensor',
            terminal: 'trigger',
          },
        },
        {
          id: 'echo',
          from: {
            componentId: 'sensor',
            terminal: 'echo',
          },
          to: {
            componentId: 'uno',
            terminal: 'd2',
          },
        },
      ],
      viewport: {
        x: 0,
        y: 0,
        zoom: 1,
      },
      simulation: {
        running: false,
        maxIterations: 24,
      },
    },
    publicState: {
      version: 1,
      lifecycle: 'running',
      continuation: {
        version: 1,
        clockContractVersion: 1,
        engineContractVersion: 1,
        clockProfileId: 'dc-inputs-v1',
        documentDigest: '68da9706b10c638acb3ec533e05105c3039d7fb39a11d884bf88000861372070',
        modelSetDigest: 'sha256:e247ff2ce80032038d9017f919e1b96872d95fa8ec7280835463792baf8b25e2',
        committedHorizonMicroseconds: 100,
        serializedState:
          '{"version":1,"profile":"dc-inputs-v1","documentDigest":"68da9706b10c638acb3ec533e05105c3039d7fb39a11d884bf88000861372070","reachedMicroseconds":100,"inputs":[],"nextInputIndex":0,"hcSr04":[{"componentId":"sensor","runtime":{"version":1,"phase":"echo-delay","powered":true,"echoStartMicroseconds":218,"echoEndMicroseconds":6018}}],"boards":[{"componentId":"uno","loadedSource":"unsigned long duration=999; void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT);digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);delayMicroseconds(10);digitalWrite(13,LOW);duration=pulseIn(2,HIGH,30000);} void loop(){delay(100);}","runtime":{"version":7,"clockProfile":"instruction-us-v1","programFingerprint":"arduino-v1-241-ee66caf9-0e339c7b","virtualTimeMs":0.1,"resumeAtMs":30.019,"phase":"setup","programCounter":7,"loopIterationActive":false,"loopStartedAtMs":0,"loopIterations":0,"nextEventSequence":6,"eventQueue":[{"kind":"pin-mode-change","terminal":"d13","mode":"OUTPUT","sequence":0,"atMicroseconds":0},{"kind":"output-change","terminal":"d13","voltage":0,"sequence":1,"atMicroseconds":0},{"kind":"pin-mode-change","terminal":"d2","mode":"INPUT","sequence":2,"atMicroseconds":1},{"kind":"output-change","terminal":"d2","voltage":0,"sequence":3,"atMicroseconds":1},{"kind":"output-change","terminal":"d13","voltage":5,"sequence":4,"atMicroseconds":6},{"kind":"output-change","terminal":"d13","voltage":0,"sequence":5,"atMicroseconds":18}],"pulseWait":{"terminal":"d2","targetHigh":true,"phase":"wait-pulse-start","startedAtMicroseconds":19,"timeoutMicroseconds":30000,"deadlineMicroseconds":30019},"variables":{"duration":999},"locals":{},"scopes":[{"duration":{"type":"unsigned long","constant":false,"value":999}},{}],"faults":[],"pinModes":{"d13":"OUTPUT","d2":"INPUT"},"outputVoltages":{"d13":0,"d2":0},"tones":{}}}]}',
      },
    },
  },
  {
    kind: 'ping',
    document: {
      schemaVersion: 4,
      components: [
        {
          id: 'uno',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          electricalModelId: 'arduino-uno',
          electricalModelVersion: 1,
          modelProfileId: 'arduino-uno-r3',
          modelProfileVersion: 1,
          position: {
            x: 0,
            y: 0,
          },
          value: 5,
          stateProperties: {
            arduinoSource:
              'unsigned long duration=999; void setup(){pinMode(13,OUTPUT);digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);delayMicroseconds(2);digitalWrite(13,LOW);pinMode(13,INPUT);duration=pulseIn(13,HIGH,30000);} void loop(){delay(100);}',
          },
          pinIds: ['d2', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        },
        {
          id: 'sensor',
          kind: 'visual',
          componentTypeId: 'ultrasonic-sensor',
          electricalModelId: 'ping-ultrasonic-distance-sensor',
          electricalModelVersion: 1,
          modelProfileId: 'ping-3pin-canonical-echo-v1',
          modelProfileVersion: 1,
          position: {
            x: 100,
            y: 0,
          },
          value: 0,
          stateProperties: {
            distanceMeters: 1,
          },
          pinIds: ['gnd', 'vcc', 'signal'],
        },
      ],
      connections: [
        {
          id: 'vcc',
          from: {
            componentId: 'uno',
            terminal: 'power-5v',
          },
          to: {
            componentId: 'sensor',
            terminal: 'vcc',
          },
        },
        {
          id: 'gnd',
          from: {
            componentId: 'uno',
            terminal: 'power-gnd-1',
          },
          to: {
            componentId: 'sensor',
            terminal: 'gnd',
          },
        },
        {
          id: 'signal',
          from: {
            componentId: 'uno',
            terminal: 'd13',
          },
          to: {
            componentId: 'sensor',
            terminal: 'signal',
          },
        },
      ],
      viewport: {
        x: 0,
        y: 0,
        zoom: 1,
      },
      simulation: {
        running: false,
        maxIterations: 24,
      },
    },
    publicState: {
      version: 1,
      lifecycle: 'running',
      continuation: {
        version: 1,
        clockContractVersion: 1,
        engineContractVersion: 1,
        clockProfileId: 'dc-inputs-v1',
        documentDigest: 'd8be91520e50ee00f03fb1b18d007648b5646c7a165ba4979a2ca6544935b246',
        modelSetDigest: 'sha256:e247ff2ce80032038d9017f919e1b96872d95fa8ec7280835463792baf8b25e2',
        committedHorizonMicroseconds: 100,
        serializedState:
          '{"version":1,"profile":"dc-inputs-v1","documentDigest":"d8be91520e50ee00f03fb1b18d007648b5646c7a165ba4979a2ca6544935b246","reachedMicroseconds":100,"inputs":[],"nextInputIndex":0,"pingUltrasonic":[{"componentId":"sensor","runtime":{"version":1,"phase":"echo-delay","powered":true,"echoStartMicroseconds":359,"echoEndMicroseconds":6159}}],"boards":[{"componentId":"uno","loadedSource":"unsigned long duration=999; void setup(){pinMode(13,OUTPUT);digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);delayMicroseconds(2);digitalWrite(13,LOW);pinMode(13,INPUT);duration=pulseIn(13,HIGH,30000);} void loop(){delay(100);}","runtime":{"version":7,"clockProfile":"instruction-us-v1","programFingerprint":"arduino-v1-242-6100fc1c-a4ae9548","virtualTimeMs":0.1,"resumeAtMs":30.011,"phase":"setup","programCounter":7,"loopIterationActive":false,"loopStartedAtMs":0,"loopIterations":0,"nextEventSequence":5,"eventQueue":[{"kind":"pin-mode-change","terminal":"d13","mode":"OUTPUT","sequence":0,"atMicroseconds":0},{"kind":"output-change","terminal":"d13","voltage":0,"sequence":1,"atMicroseconds":0},{"kind":"output-change","terminal":"d13","voltage":5,"sequence":2,"atMicroseconds":5},{"kind":"output-change","terminal":"d13","voltage":0,"sequence":3,"atMicroseconds":9},{"kind":"pin-mode-change","terminal":"d13","mode":"INPUT","sequence":4,"atMicroseconds":10}],"pulseWait":{"terminal":"d13","targetHigh":true,"phase":"wait-pulse-start","startedAtMicroseconds":11,"timeoutMicroseconds":30000,"deadlineMicroseconds":30011},"variables":{"duration":999},"locals":{},"scopes":[{"duration":{"type":"unsigned long","constant":false,"value":999}},{}],"faults":[],"pinModes":{"d13":"INPUT"},"outputVoltages":{"d13":0},"tones":{}}}]}',
      },
    },
  },
] as const;
