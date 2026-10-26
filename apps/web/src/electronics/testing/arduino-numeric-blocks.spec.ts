import { describe, expect, it } from 'vitest';
import * as ScratchBlocks from 'scratch-blocks';
import { parseElectronicsDocument, solveCircuit } from '@asa-lab/electronics';
import { generateArduinoCode, registerArduinoBlocks } from '../arduino-blocks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {advanceClockedArduinoRuntime,analyseArduinoProgramSyntax} from '../../../../../contexts/electronics/domain/arduino-program-runtime.js';

function run(source: string) {
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
  const solved = solveCircuit(parsed.document);
  expect(solved.solved, JSON.stringify(solved.diagnostics)).toBe(true);
  return solved.controllerState!.boards[0]!.runtime;
}

describe('Arduino generated blocks use the same numeric runtime as text', () => {
  it('789 BEFORE real Workspace variable add/modulo fails closed',()=>{
    registerArduinoBlocks();ScratchBlocks.Events.disable();const w=new ScratchBlocks.Workspace();
    try {
      const setup=w.newBlock('asa_setup'),reset=w.newBlock('asa_var_set'),step=w.newBlock('asa_var_set');
      const variable=w.getVariableMap().createVariable('digit');
      for(const b of [reset,step])b.setFieldValue(variable.getId(),'NAME');
      setup.getInput('DO')!.connection!.connect(reset.previousConnection!);reset.nextConnection!.connect(step.previousConnection!);
      const modulo=w.newBlock('asa_math_modulo'),add=w.newBlock('asa_math_add'),get=w.newBlock('asa_var_get');
      get.setFieldValue(variable.getId(),'NAME');
      const num=(v:string)=>{const b=w.newBlock('asa_number');b.setFieldValue(v,'VALUE');return b;};
      reset.getInput('VALUE')!.connection!.connect(num('0').outputConnection!);
      add.getInput('A')!.connection!.connect(get.outputConnection!);add.getInput('B')!.connection!.connect(num('1').outputConnection!);
      modulo.getInput('A')!.connection!.connect(add.outputConnection!);modulo.getInput('B')!.connection!.connect(num('10').outputConnection!);
      step.getInput('VALUE')!.connection!.connect(modulo.outputConnection!);
      const source=generateArduinoCode(w),diagnostics=analyseArduinoProgramSyntax(source),actual=advanceClockedArduinoRuntime(source,{},1);
      mkdirSync('test-results/block-modulo-789',{recursive:true});
      writeFileSync('test-results/block-modulo-789/before.cpp',source);
      writeFileSync('test-results/block-modulo-789/before-workspace.json',JSON.stringify({workspace:ScratchBlocks.serialization.workspaces.save(w),source,diagnostics,actual},null,2));
      expect(source).toContain('float digit = 0;');expect(source).toContain('((digit + 1) % 10)');
      expect(actual.executionStatus).toBe('fault');expect(diagnostics.some(d=>d.message.includes('целочисленных'))).toBe(true);
    }finally{w.dispose();ScratchBlocks.Events.enable();}
  });
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
