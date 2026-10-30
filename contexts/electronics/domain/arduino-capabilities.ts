import { admittedArduinoModuloAdapters } from './arduino-modulo-adapter.js';
import { analyseArduinoProgramSyntax } from './arduino-program-runtime.js';
import { parseArduinoVoidFunctions } from './arduino-user-functions.js';
import { arduinoServoDeclarationNames } from './arduino-servo-runtime.js';

export type ArduinoSupportStatus = 'supported' | 'limited' | 'unsupported';

export interface ArduinoBlockSupport {
  readonly status: ArduinoSupportStatus;
  readonly summary: string;
}

export interface ArduinoSourceSupportDiagnostic {
  readonly code:
    | 'preprocessor'
    | 'member-call'
    | 'unsupported-call'
    | 'unknown-call'
    | 'syntax-error'
    | 'unsupported-syntax'
    | 'bounded-control-flow'
    | 'averaged-pwm'
    | 'bounded-timing'
    | 'runtime-clock'
    | 'increment';
  readonly status: Exclude<ArduinoSupportStatus, 'supported'>;
  readonly line: number;
  readonly column: number;
  readonly start: number;
  readonly length: number;
  readonly message: string;
}

const SUPPORTED = (summary: string): ArduinoBlockSupport => ({
  status: 'supported',
  summary,
});
const LIMITED = (summary: string): ArduinoBlockSupport => ({ status: 'limited', summary });
const UNSUPPORTED = (summary: string): ArduinoBlockSupport => ({
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

export const ARDUINO_TEXT_COMMAND_SUPPORT = {
  setup: LIMITED('Выполняет команды один раз после Reset.'),
  loop: LIMITED('Повторяет команды после setup().'),
  pinMode: SUPPORTED('Поддерживаются INPUT, INPUT_PULLUP и OUTPUT на D0–D13 и A0–A5.'),
  digitalWrite: SUPPORTED('Устанавливает цифровой уровень на D0–D13 и A0–A5.'),
  digitalRead: SUPPORTED('Считывает электрический уровень с D0–D13 и A0–A5.'),
  analogRead: SUPPORTED('Считывает A0–A5 как значение 0–1023.'),
  analogWrite: LIMITED('ШИМ представлен средним постоянным напряжением.'),
  delay: SUPPORTED('Задержка управляет виртуальным временем симуляции.'),
  delayMicroseconds: SUPPORTED('Задержка управляет виртуальным временем симуляции.'),
  tone: LIMITED('Создаёт сигнал 0/5 В заданной частоты; такты таймера AVR не воспроизводятся.'),
  noTone: LIMITED('Останавливает звуковой сигнал на выводе.'),
  'Servo.h': LIMITED('Подключает встроенный адаптер Servo.'),
  'Servo.attach': LIMITED('Подключает объект Servo к выводу и запускает импульсы 50 Гц.'),
  'Servo.write': LIMITED('Задаёт угол через длительность импульса.'),
  'Servo.read': LIMITED('Возвращает заданный угол Servo.'),
  'Servo.detach': LIMITED('Отключает Servo и оставляет вывод LOW.'),
  map: SUPPORTED(
    'Целочисленный map Arduino: аргументы и результат long; деление усекается к нулю.',
  ),
  constrain: SUPPORTED('Числовое ограничение диапазона поддерживается.'),
  abs: SUPPORTED('Абсолютное значение поддерживается.'),
  min: SUPPORTED('Минимум поддерживается.'),
  max: SUPPORTED('Максимум поддерживается.'),
  millis: LIMITED('Возвращает время симуляции в миллисекундах.'),
  micros: LIMITED('Возвращает время симуляции в микросекундах.'),
  pulseIn: LIMITED('Измеряет длительность HIGH/LOW импульса.'),
  readUltrasonicCm: LIMITED(
    'Измеряет расстояние через trigger/echo; использует pinMode(), digitalWrite(), delayMicroseconds() и pulseIn().',
  ),
  random: SUPPORTED('AVR 1.8.6: повторяемая последовательность; max исключён.'),
  randomSeed: SUPPORTED('Начальное состояние random; ноль сохраняет последовательность.'),
  'Serial.begin': LIMITED('Задаёт скорость порта; побитовый сигнал UART не воспроизводится.'),
  'Serial.print': LIMITED('Выводит число или текст в монитор порта.'),
  'Serial.println': LIMITED('Выводит значение с переводом строки.'),
  'Serial.available': LIMITED('Возвращает число входящих байтов.'),
  'Serial.read': LIMITED('Читает первый входящий байт или −1, если очередь пуста.'),
  HIGH: SUPPORTED('Высокий логический уровень поддерживается.'),
  LOW: SUPPORTED('Низкий логический уровень поддерживается.'),
  INPUT: SUPPORTED('Режим цифрового входа поддерживается.'),
  INPUT_PULLUP: SUPPORTED('Внутренняя подтяжка моделируется как 20 кОм.'),
  OUTPUT: SUPPORTED('Режим цифрового выхода поддерживается.'),
  LED_BUILTIN: SUPPORTED('Соответствует цифровому выводу D13.'),
} as const satisfies Readonly<Record<string, ArduinoBlockSupport>>;

export type ArduinoTextCommand = keyof typeof ARDUINO_TEXT_COMMAND_SUPPORT;

/**
 * The supported Arduino C++ subset is wider than the function registry above.
 * Keep language constructs here so the reference panel and tests use the same
 * product truth as the bounded program runtime.
 */
export const ARDUINO_LANGUAGE_FEATURE_SUPPORT = {
  comment: SUPPORTED('Однострочные и блочные комментарии игнорируются при расчёте.'),
  statement: SUPPORTED(
    'Простые команды с точкой с запятой и тела поддерживаемых функций и условий исполняются.',
  ),
  'type-int': SUPPORTED(
    'int — 16 бит; unsigned int — 16 бит без знака. Знаковое переполнение останавливает расчёт с ошибкой.',
  ),
  'type-long': SUPPORTED(
    'long — 32 бита; unsigned long — 32 бита с переходом через ноль при переполнении.',
  ),
  'type-float': LIMITED(
    'float и double округляются до 32 бит как у Uno; нечисловые и бесконечные результаты останавливают расчёт.',
  ),
  'type-bool': SUPPORTED('bool и boolean хранят true/false; числовое преобразование даёт 1/0.'),
  'type-byte': SUPPORTED('byte — 8 бит без знака; присваивание целого выполняется по модулю 256.'),
  'type-text': UNSUPPORTED(
    'char, String и строковые операции не исполняются; текст в кавычках разрешён только в Serial.print/println.',
  ),
  constant: SUPPORTED(
    'const требует начального значения и запрещает последующие присваивания и инкремент.',
  ),
  assignment: LIMITED(
    'Значения переменных сохраняются через паузы; локальные переменные доступны внутри своего блока. Сложные типы не поддерживаются.',
  ),
  if: SUPPORTED('Условие вычисляется, и исполняется подходящая ветвь.'),
  'if-else': SUPPORTED('Исполняется ровно одна ветвь if/else.'),
  for: LIMITED('Повторяет тело for с проверкой условия и изменением счётчика.'),
  while: LIMITED('Повторяет тело while, пока условие истинно.'),
  switch: LIMITED('Целочисленные switch/case/default; объявления ветвей — в блоках.'),
  'do-while': LIMITED('Выполняет тело do/while, затем проверяет условие повторения.'),
  comparison: SUPPORTED('Поддерживаются <, <=, > и >=.'),
  equality: SUPPORTED('Поддерживаются == и !=.'),
  'logical-and': SUPPORTED('Логическое И &&: правая часть не вычисляется при ложной левой.'),
  'logical-or': SUPPORTED('Логическое ИЛИ ||: правая часть не вычисляется при истинной левой.'),
  'logical-not': SUPPORTED('Логическое НЕ ! поддерживается.'),
  arithmetic: SUPPORTED(
    'Арифметика учитывает типы Uno и целочисленное деление; деление на ноль и знаковое переполнение дают явную ошибку.',
  ),
} as const satisfies Readonly<Record<string, ArduinoBlockSupport>>;

export type ArduinoLanguageFeature = keyof typeof ARDUINO_LANGUAGE_FEATURE_SUPPORT;

export function arduinoTextCommandSupport(command: string): ArduinoBlockSupport {
  return (
    ARDUINO_TEXT_COMMAND_SUPPORT[command as ArduinoTextCommand] ??
    UNSUPPORTED('Симулятор пока не исполняет эту команду.')
  );
}

const SUPPORTED_CALLS = new Set([
  'random',
  'randomseed',
  'setup',
  'loop',
  'pinmode',
  'digitalwrite',
  'analogwrite',
  'digitalread',
  'analogread',
  'delay',
  'delaymicroseconds',
  'tone',
  'notone',
  'map',
  'constrain',
  'abs',
  'min',
  'max',
  'millis',
  'micros',
  'pulsein',
  'readultrasoniccm',
]);

const CONTROL_CALLS = new Set(['if', 'while', 'for', 'switch', 'case']);

const UNSUPPORTED_CALL_MESSAGES = new Map<string, string>([
  ['shiftin', 'shiftIn() ещё не исполняется.'],
  ['shiftout', 'shiftOut() ещё не исполняется.'],
  ['attachinterrupt', 'Прерывания ещё не моделируются.'],
  ['detachinterrupt', 'Прерывания ещё не моделируются.'],
]);

function maskCommentsAndStrings(source: string): string {
  let output = '';
  let quote: '"' | "'" | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        output += '\n';
      } else output += ' ';
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        output += '  ';
        blockComment = false;
        index += 1;
      } else output += character === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      if (character === '\\') {
        output += '  ';
        index += 1;
      } else if (character === quote) {
        output += ' ';
        quote = null;
      } else output += character === '\n' ? '\n' : ' ';
      continue;
    }
    if (character === '/' && next === '/') {
      output += '  ';
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      output += '  ';
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      output += ' ';
      quote = character;
      continue;
    }
    output += character;
  }
  return output;
}

function sourcePosition(
  source: string,
  start: number,
): { readonly line: number; readonly column: number } {
  const prefix = source.slice(0, start);
  const lastNewline = prefix.lastIndexOf('\n');
  return {
    line: prefix.split('\n').length,
    column: start - lastNewline,
  };
}

export function analyseArduinoSourceSupport(
  source: string,
): readonly ArduinoSourceSupportDiagnostic[] {
  const modulo = admittedArduinoModuloAdapters(maskCommentsAndStrings(source));
  const clean = modulo.source;
  const servoDeclarations = new Set(arduinoServoDeclarationNames(clean));
  const diagnostics: ArduinoSourceSupportDiagnostic[] = [];
  const dedupe = new Set<string>();
  const add = (
    code: ArduinoSourceSupportDiagnostic['code'],
    status: ArduinoSourceSupportDiagnostic['status'],
    start: number,
    length: number,
    message: string,
  ): void => {
    const key = `${code}:${start}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    diagnostics.push({ code, status, start, length, message, ...sourcePosition(source, start) });
  };

  const syntaxDiagnostics = analyseArduinoProgramSyntax(source);
  const helperNames = new Set(
    syntaxDiagnostics.length
      ? []
      : parseArduinoVoidFunctions(source).functions.map((fn) => fn.name),
  );
  for (const syntaxDiagnostic of syntaxDiagnostics) {
    add(
      'syntax-error',
      'unsupported',
      syntaxDiagnostic.start ?? 0,
      syntaxDiagnostic.length ?? 0,
      syntaxDiagnostic.message,
    );
  }

  for (const match of clean.matchAll(/^\s*#\s*(?:include|define|if|ifdef|ifndef|pragma)\b.*$/gim)) {
    const start = match.index ?? 0;
    if (/^\s*#\s*include\s*<Servo\.h>\s*$/.test(match[0])) {
      add(
        'bounded-timing',
        'limited',
        start,
        Math.max(1, match[0].trim().length),
        ARDUINO_TEXT_COMMAND_SUPPORT['Servo.h'].summary,
      );
      continue;
    }
    add(
      'preprocessor',
      'unsupported',
      start,
      Math.max(1, match[0].trim().length),
      'Разрешён только #include <Servo.h>; остальные директивы блокируют запуск.',
    );
  }

  const memberCallRanges: Array<{ readonly start: number; readonly end: number }> = [];
  for (const match of clean.matchAll(/\b([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\(/g)) {
    const start = match.index ?? 0;
    const objectName = match[1]!;
    const method = match[2]!;
    const command = servoDeclarations.has(objectName)
      ? `Servo.${method}`
      : `${objectName}.${method}`;
    const support = ARDUINO_TEXT_COMMAND_SUPPORT[command as ArduinoTextCommand];
    memberCallRanges.push({ start, end: start + match[0].length });
    if (!support || support.status === 'unsupported') {
      add(
        'member-call',
        'unsupported',
        start,
        Math.max(1, match[0].length - 1),
        support?.summary ?? `Симулятор пока не исполняет ${command}().`,
      );
    } else if (support.status === 'limited') {
      add('bounded-timing', 'limited', start, Math.max(1, match[0].length - 1), support.summary);
    }
  }

  for (const match of clean.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1] ?? '';
    const lower = name.toLowerCase();
    const start = match.index ?? 0;
    const insideMemberCall = memberCallRanges.some(
      (range) => start >= range.start && start < range.end,
    );
    if (
      insideMemberCall ||
      SUPPORTED_CALLS.has(lower) ||
      CONTROL_CALLS.has(lower) ||
      helperNames.has(name) ||
      modulo.names.includes(name)
    )
      continue;
    const knownMessage = UNSUPPORTED_CALL_MESSAGES.get(lower);
    add(
      knownMessage ? 'unsupported-call' : 'unknown-call',
      'unsupported',
      start,
      name.length,
      knownMessage ?? `Симулятор пока не исполняет ${name}().`,
    );
  }

  for (const match of clean.matchAll(/\bgoto\b/gi)) {
    add(
      'unsupported-syntax',
      'unsupported',
      match.index ?? 0,
      match[0].length,
      `Симулятор пока не исполняет ${match[0]}.`,
    );
  }

  for (const match of clean.matchAll(/\b(?:char|String)\b/g)) {
    add(
      'unsupported-syntax',
      'unsupported',
      match.index ?? 0,
      match[0].length,
      `Симулятор пока не исполняет ${match[0]} и строковые операции.`,
    );
  }

  const limitedPatterns: readonly {
    readonly expression: RegExp;
    readonly code: ArduinoSourceSupportDiagnostic['code'];
    readonly message: string;
  }[] = [
    {
      expression: /\b(?:for|while)\s*\(/gi,
      code: 'bounded-control-flow',
      message: 'Повторяет команды, пока условие истинно.',
    },
    {
      expression: /\banalogWrite\s*\(/gi,
      code: 'averaged-pwm',
      message: 'ШИМ представлен средним постоянным напряжением.',
    },
    {
      expression: /\b(?:tone|noTone)\s*\(/gi,
      code: 'bounded-timing',
      message:
        'tone() задаёт частоту сигнала 0/5 В, noTone() выключает его; такты таймера AVR не воспроизводятся.',
    },
    {
      expression: /\bpulseIn\s*\(/gi,
      code: 'bounded-timing',
      message:
        'pulseIn() ждёт импульс HIGH/LOW и возвращает его длительность; по таймауту возвращает 0.',
    },
    {
      expression: /\breadUltrasonicCm\s*\(/gi,
      code: 'bounded-timing',
      message: 'readUltrasonicCm() измеряет расстояние через выводы trigger/echo.',
    },
    {
      expression: /\b(?:millis|micros)\s*\(/gi,
      code: 'runtime-clock',
      message: 'millis() возвращает миллисекунды, micros() — микросекунды времени симуляции.',
    },
    {
      expression: /(?:\+\+|--)/g,
      code: 'increment',
      message: '++ увеличивает переменную на 1, -- уменьшает; const и bool изменять нельзя.',
    },
  ];
  for (const pattern of limitedPatterns) {
    for (const match of clean.matchAll(pattern.expression)) {
      add(
        pattern.code,
        'limited',
        match.index ?? 0,
        Math.max(1, match[0].trim().length),
        pattern.message,
      );
    }
  }

  return diagnostics.sort(
    (left, right) => left.start - right.start || left.code.localeCompare(right.code),
  );
}

export function arduinoSourceHasUnsupportedFeatures(source: string): boolean {
  return analyseArduinoSourceSupport(source).some(
    (diagnostic) => diagnostic.status === 'unsupported',
  );
}
