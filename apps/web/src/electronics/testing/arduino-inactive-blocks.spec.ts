/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as S from 'scratch-blocks';
import {
  registerArduinoBlocks,
  generateArduinoCode,
  applyArduinoBlockDefaults,
} from '../arduino-blocks';
import { activeArduinoGraph, fixedArduinoServoPins } from '../arduino-pin-inputs';

let w: S.Workspace;
beforeEach(() => {
  registerArduinoBlocks();
  S.Events.disable();
  w = new S.Workspace();
});
afterEach(() => {
  w.dispose();
  S.Events.enable();
});
function body(root: S.Block, child: S.Block) {
  root.getInput('DO')!.connection!.connect(child.previousConnection!);
}
function input(block: S.Block, name: string, child: S.Block) {
  block.getInput(name)!.connection!.connect(child.outputConnection!);
}
function named(name: string) {
  const v = w.getVariableMap().createVariable(name);
  const block = w.newBlock('asa_var_get');
  block.setFieldValue(v.getId(), 'NAME');
  return block;
}
function code() {
  applyArduinoBlockDefaults(w);
  return generateArduinoCode(w);
}

describe('connected Arduino program', () => {
  it.each([['asa_setup'], ['asa_loop'], ['asa_setup', 'asa_loop']])(
    'ignores detached globals with roots %s',
    (...roots) => {
      for (const type of roots) {
        const root = w.newBlock(type);
        body(root, w.newBlock('asa_builtin_led'));
      }
      const before = code();
      const detached = w.newBlock('asa_repeat');
      const types = [
        'asa_servo_write',
        'asa_servo_read',
        'asa_lcd_setup',
        'asa_lcd_i2c_setup',
        'asa_lcd_print',
        'asa_7seg_setup',
        'asa_neopixel_setup',
        'asa_neopixel_set',
        'asa_serial_print',
        'asa_ultrasonic',
        'asa_var_set',
        'asa_for',
      ];
      for (const type of types) {
        const block = w.newBlock(type);
        if (block.previousConnection) {
          if (!detached.getInputTargetBlock('DO')) body(detached, block);
          else {
            let tail = detached.getInputTargetBlock('DO')!;
            while (tail.getNextBlock()) tail = tail.getNextBlock()!;
            tail.nextConnection!.connect(block.previousConnection);
          }
        }
      }
      const orphan = named('repeatIndex');
      expect(code()).toBe(before);
      detached.moveBy(80, 30);
      w.getVariableMap().renameVariable(
        w.getVariableMap().getVariableById(orphan.getFieldValue('NAME'))!,
        'lcd',
      );
      expect(code()).toBe(before);
      expect(fixedArduinoServoPins(w)).toEqual([]);
      expect(activeArduinoGraph(w).active.has(detached)).toBe(false);
    },
  );

  it('uses only first setup/loop roots and ignores later duplicate descendants', () => {
    for (const type of ['asa_setup', 'asa_loop']) body(w.newBlock(type), w.newBlock('asa_wait'));
    const before = code();
    for (const type of ['asa_setup', 'asa_loop'])
      body(w.newBlock(type), w.newBlock('asa_serial_print'));
    expect(code()).toBe(before);
    const selected = activeArduinoGraph(w).loop!;
    selected.dispose(false);
    expect(code()).toContain('Serial.begin(9600)');
  });

  it('falls back to complete top-level statement chains, leaving standalone reporters unused', () => {
    const a = w.newBlock('asa_comment');
    a.setFieldValue('first', 'TEXT');
    const b = w.newBlock('asa_comment');
    b.setFieldValue('second', 'TEXT');
    a.nextConnection!.connect(b.previousConnection!);
    const print = w.newBlock('asa_serial_print');
    input(print, 'TEXT', named('active'));
    const orphan = w.newBlock('asa_ultrasonic');
    named('lcd');
    const source = code();
    expect(source).toContain('void loop()\n{\n  // first\n  // second\n  Serial.println(active);');
    expect(source).toContain('float active = 0;');
    expect(source).not.toContain('readUltrasonicCm');
    expect(activeArduinoGraph(w).active.has(orphan)).toBe(false);
  });

  it('follows nested statements, next and numeric/Boolean inputs and restores code after reconnect', () => {
    const loop = w.newBlock('asa_loop');
    const repeat = w.newBlock('asa_repeat');
    body(loop, repeat);
    input(repeat, 'COUNT', named('count'));
    const conditional = w.newBlock('asa_if');
    body(repeat, conditional);
    input(conditional, 'CONDITION', w.newBlock('asa_digital_read'));
    const print = w.newBlock('asa_serial_print');
    body(conditional, print);
    input(print, 'TEXT', w.newBlock('asa_ultrasonic'));
    print.nextConnection!.connect(w.newBlock('asa_builtin_led').previousConnection!);
    const before = code();
    expect(before).toContain('readUltrasonicCm');
    expect(before).toContain('Serial.begin(9600)');
    repeat.unplug(false);
    const detached = code();
    for (const unused of ['float count', 'Serial.', 'readUltrasonicCm', 'pinMode'])
      expect(detached).not.toContain(unused);
    body(loop, repeat);
    expect(code()).toBe(before);
  });

  it('reserves names from active references and ignores detached variables and loop counters', () => {
    const loop = w.newBlock('asa_loop');
    const repeat = w.newBlock('asa_repeat');
    body(loop, repeat);
    input(repeat, 'COUNT', named('repeatIndex'));
    const before = code();
    const orphan = named('repeatIndex_1');
    const counter = w.newBlock('asa_for');
    counter.setFieldValue('repeatIndex_2', 'NAME');
    expect(code()).toBe(before);
    w.getVariableMap().renameVariable(
      w.getVariableMap().getVariableById(orphan.getFieldValue('NAME'))!,
      'repeatIndex_3',
    );
    expect(code()).toBe(before);
    const active = repeat.getInputTargetBlock('COUNT')!;
    w.getVariableMap().renameVariable(
      w.getVariableMap().getVariableById(active.getFieldValue('NAME'))!,
      'pupilCount',
    );
    expect(code()).toContain('float pupilCount = 0;');
    expect(code()).not.toContain('repeatIndex_1');
  });

  it('isolates fixed/computed Servo allocation and LCD/I2C conflicts from detached trees', () => {
    const setup = w.newBlock('asa_setup');
    const lcd = w.newBlock('asa_lcd_setup');
    body(setup, lcd);
    input(lcd, 'RS', named('lcdPin'));
    const servo = w.newBlock('asa_servo_write');
    lcd.nextConnection!.connect(servo.previousConnection!);
    input(servo, 'PIN', named('servoPin'));
    const before = code();
    const orphanI2c = w.newBlock('asa_lcd_i2c_setup');
    const orphanServo = w.newBlock('asa_servo_write');
    input(
      orphanServo,
      'PIN',
      (() => {
        const n = w.newBlock('asa_number');
        n.setFieldValue('9', 'VALUE');
        return n;
      })(),
    );
    named('asaDynamicServo0');
    named('lcd');
    expect(code()).toBe(before);
    expect(fixedArduinoServoPins(w)).toEqual([]);
    servo.nextConnection!.connect(orphanServo.previousConnection!);
    expect(fixedArduinoServoPins(w)).toEqual(['9']);
    expect(code()).toContain('Servo servo_9;');
    orphanServo.nextConnection!.connect(orphanI2c.previousConnection!);
    expect(code()).toContain('#include <LiquidCrystal_I2C.h>');
    expect(code()).not.toContain('LiquidCrystal *lcd');
  });
});
