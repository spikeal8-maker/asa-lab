import { describe, expect, it } from 'vitest';
import * as ScratchBlocks from 'scratch-blocks';
import {
  arduinoModuloAdapterSource,
  parseElectronicsDocument,
  solveCircuit,
} from '@asa-lab/electronics';
import { generateArduinoCode, registerArduinoBlocks } from '../arduino-blocks';

function solve(source: string) {
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
  return solveCircuit(parsed.document);
}

function run(source: string) {
  const solved = solve(source);
  expect(solved.solved, JSON.stringify(solved.diagnostics)).toBe(true);
  return solved.controllerState!.boards[0]!.runtime;
}

describe('Arduino generated blocks use the same numeric runtime as text', () => {
  it.each(['2', '2.5'])('executes generated division with denominator %s', (denominator) => {
    registerArduinoBlocks();
    ScratchBlocks.Events.disable();
    const workspace = new ScratchBlocks.Workspace();
    try {
      const setup = workspace.newBlock('asa_setup');
      const assign = workspace.newBlock('asa_var_set');
      const variable = workspace.getVariableMap().createVariable('result');
      assign.setFieldValue(variable.getId(), 'NAME');
      const divide = workspace.newBlock('asa_math_divide');
      const a = workspace.newBlock('asa_number');
      const b = workspace.newBlock('asa_number');
      a.setFieldValue('7', 'VALUE');
      b.setFieldValue(denominator, 'VALUE');
      divide.getInput('A')!.connection!.connect(a.outputConnection!);
      divide.getInput('B')!.connection!.connect(b.outputConnection!);
      assign.getInput('VALUE')!.connection!.connect(divide.outputConnection!);
      setup.getInput('DO')!.connection!.connect(assign.previousConnection!);
      const generated = generateArduinoCode(workspace);
      const result = run(generated);
      const text = run(
        `float result=0;void setup(){result=7/${b.getFieldValue('VALUE')};}void loop(){}`,
      );
      expect(result.variables).toEqual(text.variables);
      expect(result.variables.result).toBe(denominator === '2' ? 3 : Math.fround(2.8));
    } finally {
      workspace.dispose();
      ScratchBlocks.Events.enable();
    }
  });
});

function moduloWorkspace(left: string, right: string, variableName?: string): string {
  registerArduinoBlocks();
  ScratchBlocks.Events.disable();
  const workspace = new ScratchBlocks.Workspace();
  try {
    const setup = workspace.newBlock('asa_setup');
    const output = workspace.getVariableMap().createVariable('result');
    const assign = workspace.newBlock('asa_var_set');
    assign.setFieldValue(output.getId(), 'NAME');
    const modulo = workspace.newBlock('asa_math_modulo');
    const a = workspace.newBlock('asa_number');
    a.setFieldValue(left, 'VALUE');
    const b = workspace.newBlock('asa_number');
    b.setFieldValue(right, 'VALUE');
    modulo.getInput('B')!.connection!.connect(b.outputConnection!);
    if (variableName) {
      const variable = workspace.getVariableMap().createVariable(variableName);
      const initial = workspace.newBlock('asa_var_set');
      initial.setFieldValue(variable.getId(), 'NAME');
      const add = workspace.newBlock('asa_math_add');
      const zero = workspace.newBlock('asa_number');
      zero.setFieldValue('0', 'VALUE');
      add.getInput('A')!.connection!.connect(a.outputConnection!);
      add.getInput('B')!.connection!.connect(zero.outputConnection!);
      initial.getInput('VALUE')!.connection!.connect(add.outputConnection!);
      const read = workspace.newBlock('asa_var_get');
      read.setFieldValue(variable.getId(), 'NAME');
      modulo.getInput('A')!.connection!.connect(read.outputConnection!);
      setup.getInput('DO')!.connection!.connect(initial.previousConnection!);
      initial.nextConnection!.connect(assign.previousConnection!);
    } else {
      modulo.getInput('A')!.connection!.connect(a.outputConnection!);
      setup.getInput('DO')!.connection!.connect(assign.previousConnection!);
    }
    assign.getInput('VALUE')!.connection!.connect(modulo.outputConnection!);
    return generateArduinoCode(workspace);
  } finally {
    workspace.dispose();
    ScratchBlocks.Events.enable();
  }
}

const adapter = arduinoModuloAdapterSource('asaBlockModulo');
describe('portable generated modulo', () => {
  it.each([
    ['7', '2', 1],
    ['7.5', '2', 1.5],
    ['-7.5', '2', -1.5],
    ['7.5', '-2', 1.5],
  ])('executes real variable add/mod %s %s', (a, b, result) => {
    const source = moduloWorkspace(a, b, 'value');
    expect(source).toContain('float value = 0;');
    expect(source).toContain('asaBlockModulo(value,');
    expect(run(source).variables.result).toBe(result);
    // Original generated floating percent remains invalid text C++.
    const before = source
      .replace(adapter, '')
      .replace('asaBlockModulo(value, ' + b + ')', '(value % ' + b + ')');
    expect(solve(before).solved).toBe(false);
  });
  it('preserves valid literal percent source and omits the adapter', () => {
    const source = moduloWorkspace('7', '2');
    expect(source).toContain('result = (7 % 2);');
    expect(source).not.toContain('asaBlockModulo');
    expect(run(source).variables.result).toBe(1);
  });
  it('reserves helper names against pupil variables', () => {
    const source = moduloWorkspace('7.5', '2', 'asaBlockModulo');
    expect(source).toContain(arduinoModuloAdapterSource('asaBlockModulo_1'));
    expect(run(source).variables.result).toBe(1.5);
  });
  it.each([
    ['int a=-7;int b=2;', '-1', '0'],
    ['unsigned long a=16777219UL;unsigned long b=4UL;', '3', '1'],
    ['long a=-7L;unsigned int b=2U;', '-1', '0'],
    ['unsigned int a=65535U;long b=2L;', '1', '0'],
    ['float a=7.5;int b=2;', '1.5', '0.75'],
    ['unsigned long a=16777219UL;float b=4;', '0', '0'],
  ])('preserves overload/result types for %s', (declarations, remainder, quotient) => {
    const state = run(
      `${adapter}\n${declarations} double result=0; double divided=0;void setup(){result=asaBlockModulo(a,b);divided=asaBlockModulo(a,b)/2;}void loop(){}`,
    );
    expect(state.variables.result).toBe(Number(remainder));
    expect(state.variables.divided).toBe(Number(quotient));
  });
  it('evaluates increment arguments once', () => {
    const state = run(
      `${adapter}\nint a=7;int b=2;double result=0;void setup(){result=asaBlockModulo(a++,b++);}void loop(){}`,
    );
    expect(state.variables).toMatchObject({ a: 8, b: 3, result: 1 });
  });
  it.each(['float a=7;float b=0;', 'int a=7;int b=0;', 'float a=3.4e38;float b=1;'])(
    'fails closed for %s',
    (declarations) => {
      const expression = declarations.includes('3.4e38')
        ? 'asaBlockModulo(a*a,b)'
        : 'asaBlockModulo(a,b)';
      expect(
        solve(`${adapter}\n${declarations}void setup(){double x=${expression};}void loop(){}`)
          .solved,
      ).toBe(false);
    },
  );
  it.each([
    adapter.replace('return a%b;', 'return a+b;'),
    adapter + '\nint asaBlockModulo(int a,int b){return 0;}',
    adapter + '\nint asaBlockModulo;',
    'double other(double a,double b){return fmod(a,b);}',
  ])('rejects altered/additional arbitrary helper definitions', (source) => {
    expect(
      solve(`${source}\nvoid setup(){double x=asaBlockModulo(7,2);}void loop(){}`).solved,
    ).toBe(false);
  });
});
