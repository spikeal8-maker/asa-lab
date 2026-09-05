import { describe, expect, it } from 'vitest';
import { DEFAULT_ARDUINO_SOURCE, readArduinoProgramState } from '../arduino-program-state';

describe('Arduino saved program ownership', () => {
  const source = 'void setup() {} void loop() { analogWrite(9, analogRead(A0) / 4); }';

  it('opens a source-only imported sketch as text, without generating blocks over it', () => {
    expect(readArduinoProgramState({ arduinoSource: source })).toMatchObject({
      mode: 'text',
      source,
      workspaceJson: '',
    });
  });

  it('still starts a new board in blocks mode', () => {
    expect(readArduinoProgramState(undefined)).toMatchObject({
      mode: 'blocks',
      source: DEFAULT_ARDUINO_SOURCE,
    });
  });

  it.each(['blocks', 'blocks-text', 'text'] as const)('respects an explicit %s choice', (mode) => {
    expect(readArduinoProgramState({ arduinoCodeMode: mode, arduinoSource: source }).mode).toBe(
      mode,
    );
  });

  it('keeps saved blocks as the source when workspace metadata exists', () => {
    const workspace = '{"blocks":{"languageVersion":0,"blocks":[]}}';
    expect(
      readArduinoProgramState({ arduinoWorkspace: workspace, arduinoSource: source }),
    ).toMatchObject({ mode: 'blocks', workspaceJson: workspace, source });
  });
});
