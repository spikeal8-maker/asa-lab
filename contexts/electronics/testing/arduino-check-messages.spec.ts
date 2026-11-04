import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  analyseArduinoSourceSupport,
  arduinoSourceHasUnsupportedFeatures,
  ARDUINO_BLOCK_SUPPORT,
  ARDUINO_TEXT_COMMAND_SUPPORT,
  ARDUINO_LANGUAGE_FEATURE_SUPPORT,
} from '../domain/arduino-capabilities';
import {
  advanceClockedArduinoRuntime,
  analyseArduinoProgramSyntax,
} from '../domain/arduino-program-runtime';

const before = JSON.parse(
  readFileSync(
    'docs/product/electronics/evidence/arduino-check-863/before/structures.json',
    'utf8',
  ),
) as { cases: Record<string, { source: string }>; registries: unknown };

function withoutCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCopy);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'message' && key !== 'summary')
        .map(([key, child]) => [key, withoutCopy(child)]),
    );
  }
  return value;
}

describe('Arduino check copy preserves the published before behavior', () => {
  it.each(Object.entries(before.cases))('%s retains every non-message field', (_, baseline) => {
    const source = baseline.source;
    const actual = {
      source,
      diagnostics: analyseArduinoSourceSupport(source),
      syntax: analyseArduinoProgramSyntax(source),
      blocked: arduinoSourceHasUnsupportedFeatures(source),
      runtime: advanceClockedArduinoRuntime(source, {}, 1),
    };
    // Includes ordered diagnostics, original UTF16 ranges, admission and actual
    // numerical/runtime state and events, not merely the displayed counts.
    expect(JSON.stringify(withoutCopy(actual))).toBe(JSON.stringify(withoutCopy(baseline)));
  });

  it('retains every registry key and support status', () => {
    expect(
      JSON.stringify(
        withoutCopy({
          blocks: ARDUINO_BLOCK_SUPPORT,
          commands: ARDUINO_TEXT_COMMAND_SUPPORT,
          language: ARDUINO_LANGUAGE_FEATURE_SUPPORT,
        }),
      ),
    ).toBe(JSON.stringify(withoutCopy(before.registries)));
  });
});
