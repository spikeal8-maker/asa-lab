import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARDUINO_BLOCK_SUPPORT, ARDUINO_TEXT_COMMAND_SUPPORT } from '@asa-lab/electronics';
import { ARDUINO_COMPLETIONS } from '../arduino-source-language';

const electronicsRoot = resolve(process.cwd(), 'apps/web/src/electronics');
const blocksSource = readFileSync(resolve(electronicsRoot, 'arduino-blocks.ts'), 'utf8');
const panelSource = readFileSync(resolve(electronicsRoot, 'ArduinoCodePanel.tsx'), 'utf8');
const controllerSource = readFileSync(
  resolve(electronicsRoot, 'use-electronics-workbench.ts'),
  'utf8',
);
const visualSource = readFileSync(
  resolve(electronicsRoot, 'ProductionComponentVisual.tsx'),
  'utf8',
);
const sidebarSource = readFileSync(resolve(electronicsRoot, 'WorkbenchSidebars.tsx'), 'utf8');
const stageSource = readFileSync(resolve(electronicsRoot, 'WorkbenchStage.tsx'), 'utf8');
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
    expect(css).toContain('font-weight: 500 !important');
    expect(css).toContain('.arduino-block-editor .blocklyLabelField > .blocklyText');
    expect(css).toContain('text-shadow: 0 1px 1px');
    expect(css).toContain('grid-template-columns: minmax(500px, 2fr) minmax(330px, 1fr)');
  });

  it('provides Arduino C++ syntax highlighting and contextual completions', () => {
    expect(panelSource).toContain('tokenizeArduinoSource(source)');
    expect(panelSource).toContain('arduinoCompletionsAt(source, cursor)');
    expect(panelSource).toContain('aria-label="Подсказки Arduino"');
    expect(panelSource).toContain('↑↓ выбрать · Tab вставить');
    for (const token of [
      '.token-keyword',
      '.token-type',
      '.token-builtin',
      '.token-constant',
      '.token-string',
      '.token-comment',
      '.token-preprocessor',
    ]) {
      expect(css).toContain(token);
    }
  });

  it('opens as independent resizable drawer and palette without moving the circuit', () => {
    expect(editorSource).toContain("codeOpen ? ' code-open' : ''");
    expect(editorSource).toContain("'--arduino-code-panel-width'");
    expect(panelSource).toContain('DrawerResizeHandle');
    expect(panelSource).toContain('role="separator"');
    expect(panelSource).toContain('ARDUINO_FLYOUT_MIN_WIDTH = 220');
    expect(panelSource).toContain('ARDUINO_FLYOUT_MAX_WIDTH = 520');
    expect(panelSource).toContain('ARDUINO_FLYOUT_DEFAULT_WIDTH = 290');
    expect(panelSource).toContain('PaletteResizeHandle');
    expect(panelSource).toContain('Изменить ширину палитры блоков');
    expect(panelSource).toContain('Уменьшить блоки в палитре');
    expect(panelSource).toContain('Увеличить блоки в палитре');
    expect(panelSource).toContain('responsiveFlyoutScale');
    expect(panelSource).toContain('ARDUINO_PALETTE_VISUAL_BASELINE = 1.25');
    expect(panelSource).toContain('arduino-palette-scale-v2');
    expect(panelSource).toContain("getFlyoutScale'");
    expect(editorSource).toContain('loadArduinoCodePanel().then');
    expect(editorSource).toContain('codePanelMounted ?');
    expect(css).toContain('.arduino-code-panel.closed');
    expect(css).toContain('.arduino-palette-scale');
    expect(panelSource).toContain('centerArduinoProgram(workspace)');
    expect(panelSource).toContain("image.setAttribute('href', url)");
    expect(blocksSource).not.toContain("delete definition['colour']");
    expect(css).not.toContain('.workbench-shell.code-open .workbench-stage');
    expect(css).toContain('.arduino-palette-resize-handle');
    expect(css).toContain('inset: 0 0 0 auto');
    expect(css).toContain('.arduino-scratch-host');
    expect(css).toContain('inset: 0;');
    expect(blocksSource).toContain('ARDUINO_FLYOUT_HEADER_GAP = 98');
    expect(blocksSource).toContain("kind: 'sep'");
    expect(blocksSource).toContain('ARDUINO_FLYOUT_HEADER_GAP / Math.max(0.1, flyoutScale)');
    expect(panelSource.indexOf('<ScratchWorkspace')).toBeLessThan(
      panelSource.indexOf('className="arduino-block-categories"'),
    );
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

  it('marks every offered block and diagnoses unsupported text before simulation', () => {
    const toolboxMatch = blocksSource.match(
      /const TOOLBOX_BY_CATEGORY:[\s\S]*?= \{([\s\S]*?)\n\};/,
    );
    const offeredBlocks = [...(toolboxMatch?.[1] ?? '').matchAll(/'(asa_[a-z0-9_]+)'/g)].map(
      (match) => match[1],
    );
    expect(offeredBlocks.length).toBeGreaterThan(50);
    expect(offeredBlocks.filter((block) => !(block in ARDUINO_BLOCK_SUPPORT))).toEqual([]);
    expect(
      ARDUINO_COMPLETIONS.filter(
        (completion) => !(completion.label in ARDUINO_TEXT_COMMAND_SUPPORT),
      ),
    ).toEqual([]);
    expect(blocksSource).toContain("const UNSUPPORTED_BLOCK = '#59636b'");
    expect(blocksSource).toContain(
      "support.status === 'unsupported' ? { colour: UNSUPPORTED_BLOCK }",
    );
    expect(blocksSource).toContain("? 'Пока не работает.'");
    expect(blocksSource).not.toContain('message0: `${marker}');
    expect(panelSource).toContain('analyseArduinoSourceSupport(source)');
    expect(panelSource).toContain('Не исполняется: ${unsupportedCount}');
    expect(panelSource).toContain('Расчёт заблокирован');
    expect(panelSource).not.toContain('arduino-support-legend');
    expect(css).toContain('.arduino-source-diagnostics.has-errors');
    expect(css).not.toContain('.arduino-support-legend');
  });

  it('keeps block inputs visible and supports complete stack actions', () => {
    expect(blocksSource).toContain("name: 'TIME', value: 1");
    expect(blocksSource).toContain("name: 'VALUE', value: '0'");
    expect(blocksSource).toContain('TOOLBOX_INPUT_DEFAULTS');
    expect(blocksSource).toContain('applyArduinoBlockDefaults');
    expect(blocksSource).toContain('asa_var_set: { VALUE: NUMBER_SHADOW() }');
    expect(blocksSource).toContain("asa_analog_write: { VALUE: NUMBER_SHADOW('0') }");
    expect(blocksSource).toContain("node['type'] === 'asa_analog_write'");
    expect(blocksSource).toContain("block.getInputTargetBlock('VALUE')");
    expect(panelSource).toContain('arduino-block-context-menu');
    expect(panelSource).toContain('block.toCopyData(true)');
    expect(panelSource).toContain('block.dispose(false, true)');
    expect(panelSource).toContain('workspace.cancelCurrentGesture()');
    expect(css).toContain('.arduino-block-context-menu');
    expect(css).toContain('.arduino-block-editor-active .blocklyWidgetDiv .blocklyHtmlInput');
  });

  it('creates and persists genuine Blockly variables', () => {
    expect(blocksSource).toContain("ARDUINO_CREATE_VARIABLE_CALLBACK = 'CREATE_ARDUINO_VARIABLE'");
    expect(blocksSource).toContain("type: 'field_variable'");
    expect(blocksSource).toContain('migrateLegacyArduinoWorkspaceState');
    expect(blocksSource).toContain("text: 'Создать переменную'");
    expect(blocksSource).toContain('Переименовать «${variable.name}»');
    expect(blocksSource).toContain('Удалить «${variable.name}»');
    expect(panelSource).toContain('ScratchBlocks.ScratchVariables.setPromptHandler');
    expect(panelSource).toContain('ScratchBlocks.ScratchVariables.createVariable');
    expect(panelSource).toContain('arduino-variable-dialog');
    expect(css).toContain('.arduino-variable-dialog');
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

  it('shows live Uno indicators, restarts the program and keeps pin details compact', () => {
    expect(visualSource).toContain('data-testid={`arduino-led-${indicator.id}`}');
    for (const indicator of ['l', 'tx', 'rx', 'on']) {
      expect(visualSource).toContain(`id: '${indicator}'`);
    }
    expect(visualSource).toContain('data-testid="arduino-reset-button"');
    expect(controllerSource).toContain('simulationStartedAtRef');
    expect(controllerSource).toContain('function resetArduinoRuntime(');
    expect(stageSource).toContain('simulationTimeMs={c.simulationTimeMs}');
    expect(stageSource).not.toContain('<title>{diagnosticText}</title>');
    expect(sidebarSource).toContain('data-testid="arduino-compact-summary"');
    expect(sidebarSource).toContain('selectedIsArduino && stateOpen');
    expect(sidebarSource).toContain("data-testid={selectedIsArduino ? 'arduino-pin-details'");
    expect(sidebarSource).toContain("selectedIsArduino ? ' arduino-pin-status' : ''");
    expect(sidebarSource).toContain('` · АЦП ${reading}/1023`');
    expect(sidebarSource).toContain("relative >= reference * 0.5 ? 'HIGH' : 'LOW'");
    expect(css).toContain('.workbench-terminal-status.arduino-pin-status');
  });
});
