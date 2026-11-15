/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import * as S from 'scratch-blocks';
import { parseElectronicsDocument, analyseArduinoSourceSupport } from '@asa-lab/electronics';
import {
  advanceElectronicsToHorizon,
  type ElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import {
  applyArduinoBlockDefaults,
  generateArduinoCode,
  migrateLegacyArduinoWorkspaceState,
  registerArduinoBlocks,
} from '../arduino-blocks';

function advanceGenerated(source: string, horizon: number, state?: ElectronicsTimedState) {
  const parsed = parseElectronicsDocument({
    schemaVersion: 2,
    connections: [],
    components: [
      {
        id: 'uno',
        kind: 'visual',
        componentTypeId: 'arduino-uno',
        value: 5,
        position: { x: 0, y: 0 },
        pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: { arduinoSource: source },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.message);
  const result = advanceElectronicsToHorizon(parsed.document, {
    requestedHorizonMicroseconds: horizon * 1000,
    ...(state ? { state } : {}),
  });
  expect(result.diagnostics).toEqual([]);
  return result;
}
function execute(source: string) {
  return JSON.parse(advanceGenerated(source, 50).state.continuation!.serializedState).boards[0]
    .runtime;
}
function syntax(source: string) {
  return analyseArduinoSourceSupport(source).filter((d) => d.status === 'unsupported');
}

describe('Blockly loops retain legacy workspaces and executable semantics', () => {
  it.each([
    ['asa_repeat', { COUNT: '3' }, 3],
    ['asa_for', { NAME: 'i', FROM: '1', TO: '3', STEP: '1', DIRECTION: 'UP' }, 3],
    ['asa_for', { NAME: 'i', FROM: '3', TO: '1', STEP: '1', DIRECTION: 'DOWN' }, 3],
  ])('reopens legacy %s fields with nested repeats', (type, fields, count) => {
    registerArduinoBlocks();
    S.Events.disable();
    const workspace = new S.Workspace();
    try {
      const change = {
        type: 'asa_var_change',
        id: 'change',
        fields: { NAME: { id: 'count' }, VALUE: '1' },
      };
      const inner = {
        type: 'asa_repeat',
        id: 'inner',
        fields: { COUNT: '2' },
        inputs: { DO: { block: change } },
      };
      const outer = { type, id: 'outer', fields, inputs: { DO: { block: inner } } };
      const legacy = {
        variables: [{ id: 'count', name: 'count', type: S.SCALAR_VARIABLE_TYPE }],
        blocks: {
          blocks: [
            { type: 'asa_setup', id: 'setup', inputs: { DO: { block: outer } } },
            {
              type: 'asa_loop',
              id: 'loop',
              inputs: {
                DO: { block: { type: 'asa_wait', fields: { TIME: '1', UNIT: 'SECONDS' } } },
              },
            },
          ],
        },
      };
      S.serialization.workspaces.load(migrateLegacyArduinoWorkspaceState(legacy), workspace);
      applyArduinoBlockDefaults(workspace);
      const code = generateArduinoCode(workspace);
      expect(syntax(code)).toEqual([]);
      expect(execute(code).variables.count).toBe(count * 2);
      const stored = S.serialization.workspaces.save(workspace);
      workspace.clear();
      S.serialization.workspaces.load(stored, workspace);
      expect(generateArduinoCode(workspace)).toBe(code);
      expect(execute(generateArduinoCode(workspace))).toEqual(execute(code));
    } finally {
      workspace.dispose();
      S.Events.enable();
    }
  });

  it.each(['asa_while', 'until', 'asa_forever'])(
    'generates %s with delay that resumes after serialization',
    (type) => {
      registerArduinoBlocks();
      S.Events.disable();
      const workspace = new S.Workspace();
      try {
        const setup = workspace.newBlock('asa_setup');
        const loop = workspace.newBlock(type === 'until' ? 'asa_while' : type);
        setup.getInput('DO')!.connection!.connect(loop.previousConnection!);
        if (type !== 'asa_forever') {
          const compare = workspace.newBlock('asa_compare_lt');
          for (const [input, value] of [
            ['A', '1'],
            ['B', type === 'until' ? '0' : '2'],
          ]) {
            const number = workspace.newBlock('asa_number');
            number.setFieldValue(value!, 'VALUE');
            compare.getInput(input!)!.connection!.connect(number.outputConnection!);
          }
          let condition = compare;
          if (type === 'until') {
            condition = workspace.newBlock('asa_logic_not');
            condition.getInput('VALUE')!.connection!.connect(compare.outputConnection!);
          }
          loop.getInput('CONDITION')!.connection!.connect(condition.outputConnection!);
        }
        const wait = workspace.newBlock('asa_wait');
        wait.setFieldValue('MILLISECONDS', 'UNIT');
        const duration = workspace.newBlock('asa_number');
        duration.setFieldValue('1', 'VALUE');
        wait.getInput('TIME')!.connection!.connect(duration.outputConnection!);
        loop.getInput('DO')!.connection!.connect(wait.previousConnection!);
        const source = generateArduinoCode(workspace);
        expect(syntax(source)).toEqual([]);
        const first = advanceGenerated(source, 1);
        const resumed = advanceGenerated(source, 2, JSON.parse(JSON.stringify(first.state)));
        const whole = advanceGenerated(source, 2);
        expect(resumed.state).toEqual(whole.state);
      } finally {
        workspace.dispose();
        S.Events.enable();
      }
    },
  );
});
