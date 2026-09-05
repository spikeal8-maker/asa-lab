export type ArduinoCodeMode = 'blocks' | 'blocks-text' | 'text';

export interface ArduinoProgramState {
  readonly mode: ArduinoCodeMode;
  readonly workspaceJson: string;
  readonly source: string;
  readonly serialOpen: boolean;
  readonly baudRate: number;
}

export const DEFAULT_ARDUINO_SOURCE = `// C++ code
//
void setup()
{
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop()
{
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000); // Wait for 1000 millisecond(s)
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000); // Wait for 1000 millisecond(s)
}
`;

export function readArduinoProgramState(
  properties: Readonly<Record<string, string | number | boolean | readonly string[]>> | undefined,
): ArduinoProgramState {
  const mode = properties?.['arduinoCodeMode'];
  const baud = properties?.['arduinoBaudRate'];
  const source = properties?.['arduinoSource'];
  const workspace = properties?.['arduinoWorkspace'];
  // Imported/legacy sketches may have source without editor metadata. Opening
  // them as blocks would generate Blink and autosave it over the user's sketch.
  const sourceOnly = typeof source === 'string' && source.trim() !== '' && !workspace;
  return {
    mode:
      mode === 'blocks' || mode === 'blocks-text' || mode === 'text'
        ? mode
        : sourceOnly
          ? 'text'
          : 'blocks',
    workspaceJson: typeof workspace === 'string' ? workspace : '',
    source: typeof source === 'string' ? source : DEFAULT_ARDUINO_SOURCE,
    serialOpen: properties?.['arduinoSerialOpen'] === true,
    baudRate: typeof baud === 'number' && Number.isFinite(baud) ? baud : 9600,
  };
}
