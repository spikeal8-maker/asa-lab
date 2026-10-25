import * as ScratchBlocks from 'scratch-blocks';

export const ARDUINO_WORKSPACE_PLUGINS = { connectionChecker: 'asa-arduino-values' };
let checkerRegistered = false;
const configuredPalettes = new WeakSet<object>();
const configuredCheckers = new WeakSet<object>();

function numericBooleanPair(a: ScratchBlocks.Connection, b: ScratchBlocks.Connection): boolean {
  const left = a.getCheck() ?? [];
  const right = b.getCheck() ?? [];
  return (
    (left.includes('Number') && right.includes('Boolean')) ||
    (left.includes('Boolean') && right.includes('Number'))
  );
}

/** Scratch's continuous flyout measures content height without the leading
 * category spacer. Include its actual bottom and reserve the zoom controls so
 * the final item can scroll fully into view in every category and scale. */
export function configureArduinoPaletteScroll(workspace: ScratchBlocks.WorkspaceSvg): void {
  const palette = workspace.getFlyout()?.getWorkspace();
  if (!palette) return;
  const manager = palette.getMetricsManager();
  if (configuredPalettes.has(manager)) return;
  const original = manager.getScrollMetrics.bind(manager);
  manager.getScrollMetrics = (workspaceCoordinates, view, content) => {
    const metrics = original(workspaceCoordinates, view, content);
    const bounds = content ?? manager.getContentMetrics(workspaceCoordinates);
    const footer = 68 / (workspaceCoordinates ? palette.scale : 1);
    return {
      ...metrics,
      height: Math.max(metrics.height, bounds.top + bounds.height + footer - metrics.top),
    };
  };
  configuredPalettes.add(manager);
  palette.scrollbar?.resize();
}

/** Arduino accepts Boolean values as 0/1 and numeric conditions as false/true.
 * Keep Number checks for round slots and Boolean checks for hexagonal slots;
 * only the type compatibility changes, never the renderer or string safety. */
export function registerArduinoConnectionChecker(): void {
  if (checkerRegistered) return;
  const Base = ScratchBlocks.registry.getClass(
    ScratchBlocks.registry.Type.CONNECTION_CHECKER,
    ScratchBlocks.registry.DEFAULT,
  ) as typeof ScratchBlocks.ConnectionChecker;
  class ArduinoConnectionChecker extends Base {
    override doTypeChecks(a: ScratchBlocks.Connection, b: ScratchBlocks.Connection): boolean {
      if (super.doTypeChecks(a, b)) return true;
      return numericBooleanPair(a, b);
    }
  }
  ScratchBlocks.registry.register(
    ScratchBlocks.registry.Type.CONNECTION_CHECKER,
    ARDUINO_WORKSPACE_PLUGINS.connectionChecker,
    ArduinoConnectionChecker,
  );
  checkerRegistered = true;
}

export function configureArduinoConnections(workspace: ScratchBlocks.WorkspaceSvg): void {
  registerArduinoConnectionChecker();
  // Pinned scratch-blocks.inject replaces the plugins option. Apply the local
  // checker through the public workspace property after injection, including
  // the flyout from which native drags originate. Never replace its global default.
  // Native connection databases/previewers may retain this exact instance.
  // Decorate its public type check rather than swapping out the instance.
  for (const target of [workspace, workspace.getFlyout()?.getWorkspace()]) {
    const checker = target?.connectionChecker;
    if (!checker || configuredCheckers.has(checker)) continue;
    const original = checker.doTypeChecks.bind(checker);
    checker.doTypeChecks = (a, b) => original(a, b) || numericBooleanPair(a, b);
    configuredCheckers.add(checker);
  }
}

export function scrollArduinoPalette(
  workspace: ScratchBlocks.WorkspaceSvg,
  direction: -1 | 1,
): void {
  const palette = workspace.getFlyout()?.getWorkspace();
  const metrics = palette?.getMetrics();
  if (!palette || !metrics) return;
  const distance = Math.max(80, metrics.viewHeight * 0.7);
  palette.scroll(palette.scrollX, palette.scrollY - direction * distance);
}

const BLOCK_HELP: Readonly<Record<string, string>> = {
  asa_setup: 'Выполняет вложенные команды один раз при запуске Arduino.',
  asa_loop: 'Повторяет вложенные команды снова и снова, пока Arduino включена.',
  asa_wait: 'Ждёт указанное время, затем переходит к следующей команде.',
  asa_repeat: 'Повторяет вложенные команды указанное число раз.',
  asa_forever: 'Повторяет вложенные команды бесконечно.',
  asa_if: 'Выполняет вложенные команды, если условие истинно.',
  asa_if_else: 'Выбирает одну из двух ветвей в зависимости от условия.',
  asa_while: 'Повторяет вложенные команды, пока условие истинно.',
  asa_for: 'Изменяет счётчик от начального до конечного значения с заданным шагом.',
  asa_builtin_led: 'Включает или выключает встроенный светодиод Arduino.',
  asa_digital_write: 'Устанавливает высокий или низкий уровень на выбранном выводе.',
  asa_analog_write: 'Задаёт значение ШИМ от 0 до 255 на выбранном выводе.',
  asa_servo_write: 'Задаёт угол поворота сервопривода на выбранном выводе.',
  asa_tone: 'Включает звук заданной частоты на выбранном выводе.',
  asa_play_note: 'Воспроизводит звук заданной частоты в течение указанного времени.',
  asa_no_tone: 'Выключает звук на выбранном выводе.',
  asa_serial_print: 'Передаёт текст или числовое значение в последовательный монитор.',
  asa_rgb_write: 'Задаёт яркость красного, зелёного и синего каналов RGB-светодиода.',
  asa_lcd_setup: 'Выбирает выводы подключения ЖК-экрана к Arduino.',
  asa_lcd_print: 'Выводит текст или значение на ЖК-экран.',
  asa_lcd_cursor: 'Перемещает курсор ЖК-экрана в выбранные столбец и строку.',
  asa_lcd_clear: 'Удаляет текст с ЖК-экрана.',
  asa_lcd_i2c_setup: 'Выбирает размер и адрес ЖК-экрана на шине I2C.',
  asa_7seg_setup: 'Настраивает номер и адрес семисегментного индикатора.',
  asa_7seg_print: 'Показывает число на выбранном семисегментном индикаторе.',
  asa_7seg_clear: 'Очищает выбранный семисегментный индикатор.',
  asa_neopixel_setup: 'Выбирает вывод и количество светодиодов в ленте NeoPixel.',
  asa_neopixel_set: 'Задаёт красный, зелёный и синий цвет выбранного светодиода ленты.',
  asa_digital_read: 'Возвращает высокий или низкий уровень выбранного цифрового входа.',
  asa_analog_read: 'Возвращает значение аналогового входа от 0 до 1023.',
  asa_ultrasonic: 'Измеряет расстояние ультразвуковым датчиком в сантиметрах.',
  asa_pulse_in: 'Измеряет длительность импульса выбранного уровня в микросекундах.',
  asa_millis: 'Возвращает число миллисекунд, прошедших с запуска Arduino.',
  asa_temperature: 'Переводит показание датчика TMP36 в градусы Цельсия.',
  asa_servo_read: 'Возвращает последний заданный угол сервопривода.',
  asa_serial_available:
    'Возвращает количество символов, ожидающих чтения из последовательного порта.',
  asa_serial_read:
    'Читает следующий символ последовательного порта; возвращает −1, если данных нет.',
  asa_ir_read: 'Считывает сигнал инфракрасного приёмника на выбранном выводе.',
  asa_number: 'Число, которое можно вставить в ячейку другого блока.',
  asa_text: 'Текст, который можно передать в блок вывода.',
  asa_math_add: 'Складывает два значения.',
  asa_math_minus: 'Вычитает второе значение из первого.',
  asa_math_multiply: 'Умножает два значения.',
  asa_math_divide: 'Делит первое значение на второе.',
  asa_math_modulo: 'Возвращает остаток от деления первого значения на второе.',
  asa_compare_lt: 'Проверяет, меньше ли первое значение второго.',
  asa_compare_eq: 'Проверяет, равны ли два значения.',
  asa_compare_gt: 'Проверяет, больше ли первое значение второго.',
  asa_logic_and: 'Истина, когда оба условия истинны.',
  asa_logic_or: 'Истина, когда хотя бы одно условие истинно.',
  asa_logic_not: 'Меняет истину на ложь, а ложь — на истину.',
  asa_random: 'Выбирает случайное целое число в заданном диапазоне.',
  asa_map: 'Переводит значение из одного числового диапазона в другой.',
  asa_constrain: 'Ограничивает значение указанными нижней и верхней границами.',
  asa_abs: 'Возвращает модуль числа: значение без знака минус.',
  asa_level: 'Высокий или низкий логический уровень: 1 или 0.',
  asa_var_get: 'Возвращает текущее значение выбранной переменной.',
  asa_var_set: 'Записывает новое значение в выбранную переменную.',
  asa_var_change: 'Прибавляет указанное значение к выбранной переменной.',
  asa_comment: 'Добавляет пояснение к программе; команды Arduino не выполняет.',
  asa_pin: 'Номер цифрового вывода. Выберите его из списка или замените блок выражением.',
  asa_pwm_pin: 'Номер ШИМ-вывода. Выберите его из списка или замените блок выражением.',
  asa_analog_pin: 'Номер аналогового входа. Выберите его из списка или замените блок выражением.',
};

export function arduinoBlockTooltip(type: string): string {
  return BLOCK_HELP[type] ?? 'Передаёт значение следующему блоку программы.';
}

export const ARDUINO_SCRATCH_THEME = ScratchBlocks.Theme.defineTheme('asa-arduino', {
  name: 'asa-arduino',
  base: ScratchBlocks.Themes.Zelos,
  blockStyles: {
    motion: {
      colourPrimary: '#4C97FF',
      colourSecondary: '#4280D7',
      colourTertiary: '#3373CC',
    },
    sensing: {
      colourPrimary: '#9966FF',
      colourSecondary: '#855CD6',
      colourTertiary: '#774DCB',
    },
    more: {
      colourPrimary: '#8E8E8E',
      colourSecondary: '#7A7A7A',
      colourTertiary: '#666666',
    },
    control: {
      colourPrimary: '#FFAB19',
      colourSecondary: '#EC9C13',
      colourTertiary: '#CF8B17',
    },
    operators: {
      colourPrimary: '#40BF4A',
      colourSecondary: '#35A941',
      colourTertiary: '#2D9238',
    },
    data: {
      colourPrimary: '#CF63CF',
      colourSecondary: '#C94FC9',
      colourTertiary: '#BD42BD',
    },
    textField: {
      colourPrimary: '#FFFFFF',
      colourSecondary: '#FFFFFF',
      colourTertiary: '#D5D5D5',
    },
  },
  componentStyles: {
    workspaceBackgroundColour: '#FFFFFF',
    toolboxBackgroundColour: '#F7F7F7',
    toolboxForegroundColour: '#43536A',
    flyoutBackgroundColour: '#F7F7F7',
    flyoutForegroundColour: '#43536A',
    flyoutOpacity: 1,
    scrollbarColour: '#C5CBD3',
    scrollbarOpacity: 0.75,
  },
  fontStyle: {
    family: 'Arial, sans-serif',
    weight: '600',
    size: 12,
  },
});
