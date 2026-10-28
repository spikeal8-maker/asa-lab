import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  analyseArduinoProgramSyntax,
  advanceClockedArduinoRuntime,
} from '../domain/arduino-program-runtime.js';
import { createArduinoCircuitClockExecutor } from '../domain/arduino-circuit-scheduler.js';
import { solveCircuitWithHeldArduino } from '../domain/solver.js';
import { arduinoSnapshotFromState } from '../domain/arduino-model.js';
import { compileCircuit, verifyCircuitQuality } from '../domain/simulation.js';
import {
  arduinoSevenSegmentMatrix,
  gpioCommonMatrix,
  outputCommonMatrix,
  FUNCTION_PROBE_SOURCE,
} from './fixtures/arduino-seven-segment-matrix.js';

describe('Arduino raw display bounded feasibility before qualification', () => {
  it('preserves the actual user-function capability failure rather than calling it functional parity', () => {
    const syntax = analyseArduinoProgramSyntax(FUNCTION_PROBE_SOURCE);
    const actual = advanceClockedArduinoRuntime(FUNCTION_PROBE_SOURCE, {}, 10);
    expect(syntax.length).toBeGreaterThan(0);
    expect(actual.diagnostics.length).toBeGreaterThan(0);
    mkdirSync('test-results/arduino-seven-segment-matrix', { recursive: true });
    writeFileSync(
      'test-results/arduino-seven-segment-matrix/functions-before.json',
      JSON.stringify(
        { status: 'BLOCKED_user_functions', source: FUNCTION_PROBE_SOURCE, syntax, actual },
        null,
        2,
      ),
    );
  });
  it.each([1, 4] as const)(
    'measures the complete %i-display real NPN multiplex circuit',
    (count) => {
      const document = arduinoSevenSegmentMatrix(count);
      expect(
        analyseArduinoProgramSyntax(String(document.components[0]!.stateProperties!.arduinoSource)),
      ).toEqual([]);
      const run = createArduinoCircuitClockExecutor(document);
      const started = performance.now();
      const actual = run(20000);
      const wallMs = performance.now() - started;
      const runtime = advanceClockedArduinoRuntime(
        String(document.components[0]!.stateProperties!.arduinoSource),
        {},
        1,
      );
      const held = solveCircuitWithHeldArduino(
        document,
        0,
        new Map([['uno', arduinoSnapshotFromState(runtime.state)]]),
      );
      const quality = verifyCircuitQuality(document, compileCircuit(document), held, {
        simulationTimeMs: 0,
      });
      mkdirSync('test-results/arduino-seven-segment-matrix', { recursive: true });
      writeFileSync(
        `test-results/arduino-seven-segment-matrix/domain-${count}.json`,
        JSON.stringify(
          {
            count,
            modelMs: 20,
            wallMs,
            document,
            actual,
            heldRuntime: runtime.state,
            held,
            quality,
          },
          null,
          2,
        ),
      );
      expect(actual.executionStatus).toBe('fault');
      expect(quality.passed).toBe(false);
    },
  );
  it.each([1, 4] as const)('probes safe GPIO common-drive alternative for %i displays', (count) => {
    const document = gpioCommonMatrix(count),
      run = createArduinoCircuitClockExecutor(document),
      started = performance.now();
    const actual = run(20000),
      wallMs = performance.now() - started;
    writeFileSync(
      `test-results/arduino-seven-segment-matrix/gpio-${count}.json`,
      JSON.stringify({ count, modelMs: 20, wallMs, document, actual }, null, 2),
    );
    expect(actual.executionStatus, JSON.stringify(actual.diagnostics)).toBe('ready');
    expect(actual.result?.quality.passed).toBe(true);
  });
  it('checks the genuine-Blockly-compatible four-digit output common circuit including reverse diagnostics', () => {
    const document = outputCommonMatrix(4),
      started = performance.now();
    const actual = createArduinoCircuitClockExecutor(document)(20000),
      wallMs = performance.now() - started;
    writeFileSync(
      'test-results/arduino-seven-segment-matrix/output-4.json',
      JSON.stringify({ document, actual, modelMs: 20, wallMs }, null, 2),
    );
    expect(actual.executionStatus, JSON.stringify(actual.diagnostics)).toBe('ready');
    expect(actual.result?.quality.passed).toBe(true);
  });
});
