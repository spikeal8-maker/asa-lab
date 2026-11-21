/** Shared static block support metadata. Runtime/text analysis stays in arduino-capabilities. */
export type ArduinoSupportStatus = 'supported' | 'limited' | 'unsupported';

export interface ArduinoBlockSupport {
  readonly status: ArduinoSupportStatus;
  readonly summary: string;
}

export const SUPPORTED = (summary: string): ArduinoBlockSupport => ({
  status: 'supported',
  summary,
});
export const LIMITED = (summary: string): ArduinoBlockSupport => ({ status: 'limited', summary });
export const UNSUPPORTED = (summary: string): ArduinoBlockSupport => ({
  status: 'unsupported',
  summary,
});

/**
 * Product-facing Arduino contract. The block editor, text diagnostics and
 * electrical solver all consume this registry so the UI cannot advertise a
 * command that the simulator silently ignores.
 */
export const ARDUINO_BLOCK_SUPPORT = {
  asa_pin: SUPPORTED('Номер цифрового вывода, включая A0–A5 в цифровом режиме.'),
  asa_pwm_pin: SUPPORTED('Номер аппаратного ШИМ-вывода Uno.'),
  asa_analog_pin: SUPPORTED('Номер аналогового входа Uno.'),
  asa_setup: LIMITED('setup() выполняется один раз после Reset.'),
  asa_loop: LIMITED('Повторяет команды loop() после setup().'),
  asa_wait: SUPPORTED('Задержка управляет фазой виртуального времени симуляции.'),
  asa_repeat: LIMITED('Повторяет команды заданное число раз.'),
  asa_forever: LIMITED('Повторяет команды; delay() делает паузу перед продолжением.'),
  asa_if: SUPPORTED('Выполняет команды, если условие истинно.'),
  asa_if_else: SUPPORTED('Одна из ветвей выбирается по вычисленному условию.'),
  asa_while: LIMITED('Повторяет команды, пока условие истинно.'),
  asa_for: LIMITED('Повторяет тело цикла с проверкой условия и изменением счётчика.'),
  asa_builtin_led: SUPPORTED('Управляет цифровым выводом D13.'),
  asa_digital_write: SUPPORTED('Устанавливает цифровой уровень на D0–D13 и A0–A5.'),
  asa_analog_write: LIMITED('ШИМ представлен средним постоянным напряжением.'),
  asa_servo_write: LIMITED('Задаёт угол Servo импульсами 50 Гц на подключённом выводе.'),
  asa_tone: LIMITED('Создаёт сигнал 0/5 В заданной частоты; такты таймера AVR не воспроизводятся.'),
  asa_play_note: LIMITED('Создаёт звуковой сигнал выбранной ноты.'),
  asa_no_tone: LIMITED('Останавливает звуковой сигнал на выводе.'),
  asa_serial_print: LIMITED(
    'Выводит число или текст в монитор порта; побитовый сигнал UART не воспроизводится.',
  ),
  asa_rgb_write: LIMITED('Три ШИМ-канала представлены средними постоянными напряжениями.'),
  asa_lcd_setup: UNSUPPORTED('ЖК-экран ещё не связан с Arduino-рантаймом.'),
  asa_lcd_print: UNSUPPORTED('ЖК-экран ещё не связан с Arduino-рантаймом.'),
  asa_lcd_cursor: UNSUPPORTED('ЖК-экран ещё не связан с Arduino-рантаймом.'),
  asa_lcd_clear: UNSUPPORTED('ЖК-экран ещё не связан с Arduino-рантаймом.'),
  asa_lcd_i2c_setup: UNSUPPORTED('I2C и библиотека ЖК-экрана ещё не исполняются.'),
  asa_7seg_setup: UNSUPPORTED('Библиотека семисегментного индикатора ещё не исполняется.'),
  asa_7seg_print: UNSUPPORTED('Библиотека семисегментного индикатора ещё не исполняется.'),
  asa_7seg_clear: UNSUPPORTED('Библиотека семисегментного индикатора ещё не исполняется.'),
  asa_neopixel_setup: UNSUPPORTED('Библиотека NeoPixel ещё не исполняется.'),
  asa_neopixel_set: UNSUPPORTED('Библиотека NeoPixel ещё не исполняется.'),
  asa_digital_read: SUPPORTED('Считывает электрический уровень с D0–D13 и A0–A5.'),
  asa_analog_read: SUPPORTED('Считывает напряжение A0–A5 как значение 0–1023.'),
  asa_ultrasonic: LIMITED('Измеряет расстояние через trigger/echo функцией readUltrasonicCm().'),
  asa_pulse_in: LIMITED('Измеряет длительность импульса HIGH/LOW во времени симуляции.'),
  asa_millis: LIMITED('Возвращает время симуляции в миллисекундах.'),
  asa_temperature: SUPPORTED('Преобразует поддерживаемое analogRead() по формуле TMP36.'),
  asa_servo_read: LIMITED('Возвращает последний заданный угол Servo.'),
  asa_serial_available: LIMITED('Возвращает число входящих байтов в очереди монитора порта.'),
  asa_serial_read: LIMITED('Читает входящий байт из монитора порта или −1, если очередь пуста.'),
  asa_ir_read: UNSUPPORTED('Протокол ИК-приёмника ещё не декодируется.'),
  asa_number: SUPPORTED('Числовой литерал поддерживается.'),
  asa_text: UNSUPPORTED('Строковые значения ещё не исполняются электрическим рантаймом.'),
  asa_math_add: SUPPORTED('Сложение поддерживается.'),
  asa_math_minus: SUPPORTED('Вычитание поддерживается.'),
  asa_math_multiply: SUPPORTED('Умножение поддерживается.'),
  asa_math_divide: SUPPORTED(
    'Целочисленное деление усекается к нулю; деление на ноль останавливает расчёт с ошибкой.',
  ),
  asa_math_modulo: SUPPORTED('Остаток от деления поддерживается.'),
  asa_compare_lt: SUPPORTED('Сравнение поддерживается.'),
  asa_compare_eq: SUPPORTED('Сравнение поддерживается.'),
  asa_compare_gt: SUPPORTED('Сравнение поддерживается.'),
  asa_logic_and: SUPPORTED('Логическое И поддерживается.'),
  asa_logic_or: SUPPORTED('Логическое ИЛИ поддерживается.'),
  asa_logic_not: SUPPORTED('Логическое НЕ поддерживается.'),
  asa_random: SUPPORTED('Повторяемый AVR random; верхняя граница блока включена.'),
  asa_map: SUPPORTED('map() поддерживается.'),
  asa_constrain: SUPPORTED('constrain() поддерживается.'),
  asa_abs: SUPPORTED('abs() поддерживается.'),
  asa_level: SUPPORTED('HIGH и LOW поддерживаются.'),
  asa_var_get: LIMITED(
    'Числовые переменные сохраняют тип и значение между тиками; сложные типы пока не поддерживаются.',
  ),
  asa_var_set: LIMITED(
    'Присваивание преобразует число к объявленному типу Uno и сохраняет его между тиками.',
  ),
  asa_var_change: LIMITED(
    'Изменение учитывает объявленный тип Uno; знаковое переполнение даёт ошибку.',
  ),
  asa_comment: SUPPORTED('Комментарий сохраняется и не влияет на расчёт.'),
} as const satisfies Readonly<Record<string, ArduinoBlockSupport>>;

export type ArduinoBlockType = keyof typeof ARDUINO_BLOCK_SUPPORT;

export function arduinoBlockSupport(blockType: string): ArduinoBlockSupport {
  return (
    ARDUINO_BLOCK_SUPPORT[blockType as ArduinoBlockType] ??
    UNSUPPORTED('Симулятор пока не исполняет этот блок.')
  );
}
