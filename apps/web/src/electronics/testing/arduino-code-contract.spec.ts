import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const electronicsRoot = resolve(process.cwd(), 'apps/web/src/electronics');
const blocksSource = readFileSync(resolve(electronicsRoot, 'arduino-blocks.ts'), 'utf8');
const panelSource = readFileSync(resolve(electronicsRoot, 'ArduinoCodePanel.tsx'), 'utf8');
const controllerSource = readFileSync(
  resolve(electronicsRoot, 'use-electronics-workbench.ts'),
  'utf8',
);
const editorSource = readFileSync(
  resolve(process.cwd(), 'apps/web/src/pages/SchematicEditor.tsx'),
  'utf8',
);
const css = readFileSync(resolve(electronicsRoot, 'workbench.css'), 'utf8');

describe('Arduino programming room contract', () => {
  it('uses the Scratch renderer and preserves all three editing modes', () => {
    expect(blocksSource).toContain("from 'scratch-blocks'");
    expect(panelSource).toContain('ScratchBlocks.inject(host');
    expect(panelSource).toContain('ScratchBlocks.ScratchBlocksTheme.CLASSIC');
    expect(panelSource).toContain("ScratchBlocks.Theme.defineTheme('asa-arduino'");
    expect(panelSource).toContain("colourPrimary: '#4C97FF'");
    expect(panelSource).toContain("colourPrimary: '#FFAB19'");
    expect(panelSource).toContain('applyScratchMediaAssets(host)');
    expect(panelSource).toContain('scratch-blocks/media/zoom-in.svg?url');
    expect(panelSource).toContain('scratch-blocks/media/sprites.png?url');
    expect(panelSource).toContain("blocks: 'Блоки'");
    expect(panelSource).toContain("'blocks-text': 'Блоки с текстом'");
    expect(panelSource).toContain("text: 'Текст'");
    expect(panelSource).toContain('Закрыть редактор блоков?');
    expect(css).toContain('.arduino-block-editor .blocklyFlyoutBackground');
    expect(css).toContain('grid-template-columns: minmax(500px, 2fr) minmax(330px, 1fr)');
  });

  it('opens as independent resizable drawer and palette without moving the circuit', () => {
    expect(editorSource).toContain("codeOpen ? ' code-open' : ''");
    expect(editorSource).toContain("'--arduino-code-panel-width'");
    expect(panelSource).toContain('DrawerResizeHandle');
    expect(panelSource).toContain('role="separator"');
    expect(panelSource).toContain('ARDUINO_FLYOUT_MIN_WIDTH = 330');
    expect(panelSource).toContain('ARDUINO_FLYOUT_MAX_WIDTH = 520');
    expect(panelSource).toContain('ARDUINO_FLYOUT_DEFAULT_WIDTH = 330');
    expect(panelSource).toContain('PaletteResizeHandle');
    expect(panelSource).toContain('Изменить ширину палитры блоков');
    expect(panelSource).toContain('centerArduinoProgram(workspace)');
    expect(panelSource).toContain("image.setAttribute('href', url)");
    expect(blocksSource).not.toContain("delete definition['colour']");
    expect(css).not.toContain('.workbench-shell.code-open .workbench-stage');
    expect(css).toContain('.arduino-palette-resize-handle');
    expect(css).toContain('inset: 0 0 0 auto');
    expect(css).toContain('inset: 98px 0 0');
    expect(css).not.toContain('transform: translate(0, 98px) !important');
  });

  it('offers the six measured categories and Arduino-specific blocks', () => {
    for (const label of ['Выход', 'Управление', 'Вход', 'Мат. данные', 'Замечание', 'Переменные']) {
      expect(panelSource).toContain(`label: '${label}'`);
    }
    for (const block of [
      'asa_builtin_led',
      'asa_digital_write',
      'asa_analog_write',
      'asa_servo_write',
      'asa_servo_read',
      'asa_serial_print',
      'asa_serial_available',
      'asa_lcd_print',
      'asa_lcd_i2c_setup',
      'asa_7seg_print',
      'asa_neopixel_set',
      'asa_digital_read',
      'asa_ultrasonic',
      'asa_if_else',
      'asa_for',
      'asa_map',
      'asa_constrain',
      'asa_var_set',
    ]) {
      expect(blocksSource).toContain(`type: '${block}'`);
    }
  });

  it('generates an Arduino sketch and persists it on the selected Uno', () => {
    expect(blocksSource).toContain('void setup()');
    expect(blocksSource).toContain('void loop()');
    expect(blocksSource).toContain('digitalWrite(LED_BUILTIN');
    expect(blocksSource).toContain('Serial.begin(9600)');
    expect(blocksSource).toContain('#include <Servo.h>');
    expect(blocksSource).toContain('#include <LiquidCrystal.h>');
    expect(panelSource).toContain('arduinoWorkspace: next.workspaceJson');
    expect(panelSource).toContain('arduinoSource: next.source');
    expect(controllerSource).toContain('function updateArduinoProgram(');
    expect(controllerSource).toContain("component.componentTypeId !== 'arduino-uno'");
  });

  it('keeps a collapsible serial monitor with send, clear and baud controls', () => {
    expect(panelSource).toContain('Монитор последовательного интерфейса');
    expect(panelSource).toContain('Сообщение в последовательный порт');
    expect(panelSource).toContain('115200');
    expect(panelSource).toContain('Отпр.');
    expect(panelSource).toContain('Очист.');
    expect(css).toContain('.arduino-serial-monitor.open');
  });
});
