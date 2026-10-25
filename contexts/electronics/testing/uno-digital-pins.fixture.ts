import { parseElectronicsDocument } from '../domain/document.js';

export const unoDigitalTerminals = [
  ...Array.from({ length: 14 }, (_, i) => `d${i}`),
  ...Array.from({ length: 6 }, (_, i) => `a${i}`),
];

export function unoDigitalSource(high: readonly number[], aliases = true) {
  return `void setup(){${unoDigitalTerminals
    .map((_, i) => {
      const pin = aliases && i >= 14 ? `A${i - 14}` : String(i);
      return `pinMode(${pin},OUTPUT);digitalWrite(${pin},${high.includes(i) ? 'HIGH' : 'LOW'});`;
    })
    .join('')}}void loop(){delay(100);}`;
}

/** Twenty separate 1 kOhm LED loads: no UART peer on the shared D0/D1 pins. */
export function unoDigitalDocument(source: string) {
  const parsed = parseElectronicsDocument({
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        componentTypeId: 'arduino-uno',
        value: 5,
        position: { x: 0, y: 0 },
        pinIds: [...unoDigitalTerminals, 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: { arduinoSource: source },
      },
      ...unoDigitalTerminals.flatMap((_, i) => [
        {
          id: `r${i}`,
          kind: 'resistor',
          componentTypeId: 'resistor-axial',
          value: 1000,
          pinIds: ['lead-1', 'lead-2'],
          position: { x: i * 30, y: 100 },
        },
        {
          id: `led${i}`,
          kind: 'led',
          componentTypeId: 'led-5mm',
          value: 2,
          pinIds: ['anode', 'cathode'],
          position: { x: i * 30, y: 150 },
        },
      ]),
    ],
    connections: unoDigitalTerminals.flatMap((terminal, i) => [
      {
        id: `drive${i}`,
        from: { componentId: 'uno', terminal },
        to: { componentId: `r${i}`, terminal: 'lead-1' },
      },
      {
        id: `series${i}`,
        from: { componentId: `r${i}`, terminal: 'lead-2' },
        to: { componentId: `led${i}`, terminal: 'anode' },
      },
      {
        id: `ground${i}`,
        from: { componentId: `led${i}`, terminal: 'cathode' },
        to: { componentId: 'uno', terminal: 'power-gnd-1' },
      },
    ]),
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 24 },
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed));
  return parsed.document;
}
