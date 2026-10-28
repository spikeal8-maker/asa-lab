import { describe, expect, it } from 'vitest';
import { createArduinoCircuitClockExecutor } from '../domain/arduino-circuit-scheduler.js';
import {
  advanceClockedArduinoRuntime,
  analyseArduinoProgramSyntax,
  type ArduinoRuntimeState,
} from '../domain/arduino-program-runtime.js';
import { arduinoSevenSegmentMatrix } from './fixtures/arduino-seven-segment-matrix.js';
import { helperDisplayCounterSource } from './fixtures/arduino-helper-display-counter.js';

describe('real helper-function Arduino display counters', () => {
  it.each([1, 2, 3, 4] as const)(
    'counts/carries for %i displays and runs their real NPN scan',
    (count) => {
      const source = helperDisplayCounterSource(count);
      expect(analyseArduinoProgramSyntax(source)).toEqual([]);
      const run = createArduinoCircuitClockExecutor(arduinoSevenSegmentMatrix(count, source));
      let physical = run(20_000);
      for (let step = 0; physical.executionStatus === 'yielded' && step < 100; step++)
        physical = run(20_000, physical.state!);
      expect(physical.executionStatus, JSON.stringify(physical.diagnostics)).toBe('ready');
      expect(physical.result?.quality.passed).toBe(true);
      expect(physical.result!.quality.maxKclResidualAmp).toBeLessThanOrEqual(1e-6);
      for (const component of physical.result!.components.filter((component) =>
        component.componentId.startsWith('display-'),
      ))
        for (const current of Object.values(component.branchCurrents!))
          expect(Math.abs(current)).toBeLessThan(0.01);
      let state: ArduinoRuntimeState | undefined;
      for (const target of [25, 65, 105]) {
        let actual = advanceClockedArduinoRuntime(source, {}, target, state, undefined, {
          instructionBudget: 256,
        });
        for (let step = 0; actual.executionStatus === 'yielded' && step < 100; step++)
          actual = advanceClockedArduinoRuntime(
            source,
            {},
            target,
            JSON.parse(JSON.stringify(actual.state)),
            undefined,
            { instructionBudget: 256 },
          );
        state = actual.state;
        expect(actual.executionStatus, JSON.stringify(actual.diagnostics)).toBe('ready');
        const variables = actual.state.variables;
        expect(Array.from({ length: count }, (_, i) => variables[`d${i}`])).toEqual(
          target === 25
            ? [8, ...Array(count - 1).fill(9)]
            : Array(count).fill(target === 65 ? 9 : 0),
        );
      }
    },
  );
});
