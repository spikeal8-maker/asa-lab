import { analyseArduinoProgramSyntax } from './arduino-program-runtime.js';
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
  asa_setup: LIMITED(
    'setup() выполняется один раз на Reset в пределах поддерживаемого подмножества.',
  ),
  asa_loop: LIMITED('loop() моделируется ограниченным циклом, а не полным AVR-рантаймом.'),
  asa_wait: SUPPORTED('Задержка управляет фазой виртуального времени симуляции.'),
  asa_repeat: LIMITED('Цикл исполняется по условию в пределах лимита операций.'),
  asa_forever: LIMITED('Бесконечный цикл останавливается защитным лимитом операций.'),
  asa_if: SUPPORTED('Условие вычисляется электрическим рантаймом.'),
  asa_if_else: SUPPORTED('Одна из ветвей выбирается по вычисленному условию.'),
  asa_while: LIMITED('Условие повторяется в пределах защитного лимита операций.'),
  asa_for: LIMITED('Заголовок и тело повторяются в пределах защитного лимита операций.'),
  asa_builtin_led: SUPPORTED('Управляет цифровым выводом D13.'),
  asa_digital_write: SUPPORTED('Устанавливает цифровой уровень на D0–D13.'),
  asa_analog_write: LIMITED('ШИМ представлен средним постоянным напряжением.'),
  asa_servo_write: LIMITED('Servo.write() управляет canonical 50 Hz waveform на attached GPIO.'),
  asa_tone: LIMITED('Формирует canonical timed 0/5 V waveform без AVR timer accuracy.'),
  asa_play_note: LIMITED('Формирует canonical timed tone waveform без AVR timer accuracy.'),
  asa_no_tone: LIMITED('Немедленно останавливает canonical tone waveform.'),
  asa_serial_print: LIMITED(
    'Передаёт детерминированный Serial TX в bounded runtime history без UI Monitor и UART bit timing.',
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
  asa_digital_read: SUPPORTED('Считывает электрический уровень с D0–D13.'),
  asa_analog_read: SUPPORTED('Считывает напряжение A0–A5 как значение 0–1023.'),
  asa_ultrasonic: LIMITED(
    'Поддержан exact adapter readUltrasonicCm(triggerPin, echoPin) поверх canonical GPIO/delay/pulseIn.',
  ),
  asa_pulse_in: LIMITED(
    'Измеряет HIGH/LOW импульс по canonical instruction-us-v1 времени; без AVR cycle accuracy.',
  ),
  asa_millis: LIMITED('Возвращает детерминированное время текущего шага симуляции.'),
  asa_temperature: SUPPORTED('Преобразует поддерживаемое analogRead() по формуле TMP36.'),
  asa_servo_read: LIMITED('Servo.read() возвращает последний commanded angle Servo object.'),
  asa_serial_available: LIMITED('Возвращает число pending Serial RX bytes без UI Monitor.'),
  asa_serial_read: LIMITED('Читает один pending Serial RX byte или -1 без UI Monitor.'),
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
  asa_random: UNSUPPORTED('Генератор случайных чисел не входит в детерминированный рантайм.'),
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
    UNSUPPORTED('Для этого блока нет подтверждённой модели исполнения.')
  );
}

export const ARDUINO_TEXT_COMMAND_SUPPORT = {
  setup: LIMITED('Точка входа поддерживается ограниченным runtime state.'),
  loop: LIMITED('Цикл моделируется в пределах детерминированного шага.'),
  pinMode: SUPPORTED('Поддерживаются INPUT, INPUT_PULLUP и OUTPUT на D0–D13.'),
  digitalWrite: SUPPORTED('Устанавливает цифровой уровень на D0–D13.'),
  digitalRead: SUPPORTED('Считывает электрический уровень с D0–D13.'),
  analogRead: SUPPORTED('Считывает A0–A5 как значение 0–1023.'),
  analogWrite: LIMITED('ШИМ представлен средним постоянным напряжением.'),
  delay: SUPPORTED('Задержка управляет виртуальным временем симуляции.'),
  delayMicroseconds: SUPPORTED('Задержка управляет виртуальным временем симуляции.'),
  tone: LIMITED('Формирует canonical timed 0/5 V waveform без AVR timer accuracy.'),
  noTone: LIMITED('Немедленно останавливает canonical tone waveform.'),
  'Servo.h': LIMITED('Поддержан bounded adapter только для exact #include <Servo.h>.'),
  'Servo.attach': LIMITED(
    'Подключает Servo object к одному Arduino GPIO и запускает 50 Hz waveform.',
  ),
  'Servo.write': LIMITED('Задаёт 0..180° через canonical servo pulse width 544..2400 us.'),
  'Servo.read': LIMITED('Возвращает последний commanded Servo angle.'),
  'Servo.detach': LIMITED('Отключает Servo object и оставляет GPIO LOW.'),
  map: SUPPORTED(
    'Целочисленный map Arduino: аргументы и результат long; деление усекается к нулю.',
  ),
  constrain: SUPPORTED('Числовое ограничение диапазона поддерживается.'),
  abs: SUPPORTED('Абсолютное значение поддерживается.'),
  min: SUPPORTED('Минимум поддерживается.'),
  max: SUPPORTED('Максимум поддерживается.'),
  millis: LIMITED('Возвращает время текущего шага симуляции.'),
  micros: LIMITED(
    'Возвращает детерминированное instruction-us-v1 время в микросекундах без AVR cycle accuracy.',
  ),
  pulseIn: LIMITED(
    'Измеряет HIGH/LOW импульс по canonical instruction-us-v1 времени; без AVR cycle accuracy.',
  ),
  readUltrasonicCm: LIMITED(
    'Exact built-in adapter для ASA Lab: trigger/echo последовательность поверх pinMode(), digitalWrite(), delayMicroseconds() и pulseIn().',
  ),
  random: UNSUPPORTED('Случайные числа не входят в детерминированный рантайм.'),
  randomSeed: UNSUPPORTED('Случайные числа не входят в детерминированный рантайм.'),
  'Serial.begin': LIMITED('Сохраняет baud rate как deterministic TX metadata без UART bit timing.'),
  'Serial.print': LIMITED('Пишет numeric или quoted-literal TX в bounded runtime history.'),
  'Serial.println': LIMITED('Пишет TX с завершающим переводом строки в bounded runtime history.'),
  'Serial.available': LIMITED(
    'Возвращает размер bounded per-board RX queue без Serial Monitor UI.',
  ),
  'Serial.read': LIMITED('Читает старейший byte из bounded per-board RX queue или -1.'),
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
    'char, String и строковые операции не исполняются; quoted literal разрешён только как аргумент Serial.print/println.',
  ),
  constant: SUPPORTED(
    'const требует начального значения и запрещает последующие присваивания и инкремент.',
  ),
  assignment: LIMITED(
    'Типизированные globals и вложенные locals сохраняются через паузы; локальные имена исчезают при выходе из области. Сложные типы пока не поддерживаются.',
  ),
  if: SUPPORTED('Условие вычисляется, и исполняется подходящая ветвь.'),
  'if-else': SUPPORTED('Исполняется ровно одна ветвь if/else.'),
  for: LIMITED('Заголовок и тело for исполняются по условию в пределах защитного лимита операций.'),
  while: LIMITED('Условие while повторяется в пределах защитного лимита операций.'),
  switch: UNSUPPORTED('switch/case ещё не входит в подтверждённое подмножество.'),
  'do-while': UNSUPPORTED('do…while ещё не входит в подтверждённое подмножество.'),
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
    UNSUPPORTED('Команда не входит в подтверждённый Arduino-рантайм ASA Lab.')
  );
}

const SUPPORTED_CALLS = new Set([
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

const CONTROL_CALLS = new Set(['if', 'while', 'for', 'switch']);

const UNSUPPORTED_CALL_MESSAGES = new Map<string, string>([
  ['random', 'random() ещё не исполняется детерминированным рантаймом.'],
  ['randomseed', 'randomSeed() ещё не исполняется детерминированным рантаймом.'],
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
  const clean = maskCommentsAndStrings(source);
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

  for (const syntaxDiagnostic of analyseArduinoProgramSyntax(source)) {
    const scope = syntaxDiagnostic.message.includes('setup()') ? 'setup' : 'loop';
    const scopeStart = clean.search(new RegExp(`\\bvoid\\s+${scope}\\b`, 'i'));
    add(
      'syntax-error',
      'unsupported',
      scopeStart >= 0 ? scopeStart : 0,
      scopeStart >= 0 ? scope.length : 1,
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
      'Разрешён только bounded adapter #include <Servo.h>; остальные директивы fail-closed.',
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
        support?.summary ?? `${command}() пока не исполняется Arduino-рантаймом.`,
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
    if (insideMemberCall || SUPPORTED_CALLS.has(lower) || CONTROL_CALLS.has(lower)) continue;
    const knownMessage = UNSUPPORTED_CALL_MESSAGES.get(lower);
    add(
      knownMessage ? 'unsupported-call' : 'unknown-call',
      'unsupported',
      start,
      name.length,
      knownMessage ?? `${name}() не входит в подтверждённый Arduino-рантайм ASA Lab.`,
    );
  }

  for (const match of clean.matchAll(/\b(?:switch|do|break|continue|goto)\b/gi)) {
    add(
      'unsupported-syntax',
      'unsupported',
      match.index ?? 0,
      match[0].length,
      `${match[0]} не входит в подтверждённое подмножество Arduino C++.`,
    );
  }

  for (const match of clean.matchAll(/\b(?:char|String)\b|\belse\s+if\b/g)) {
    add(
      'unsupported-syntax',
      'unsupported',
      match.index ?? 0,
      match[0].length,
      /else\s+if/i.test(match[0])
        ? 'Цепочка else if ещё не входит в подтверждённое подмножество; используйте один if/else.'
        : `${match[0]} и строковые операции ещё не исполняются Arduino-рантаймом.`,
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
      message: 'Цикл исполняется по условию в пределах защитного лимита операций.',
    },
    {
      expression: /\banalogWrite\s*\(/gi,
      code: 'averaged-pwm',
      message: 'ШИМ представлен средним постоянным напряжением.',
    },
    {
      expression: /\b(?:tone|noTone)\s*\(/gi,
      code: 'bounded-timing',
      message: 'tone/noTone используют canonical timed waveform без AVR timer accuracy.',
    },
    {
      expression: /\bpulseIn\s*\(/gi,
      code: 'bounded-timing',
      message: 'pulseIn() ждёт canonical входные фронты и timeout без AVR cycle accuracy.',
    },
    {
      expression: /\breadUltrasonicCm\s*\(/gi,
      code: 'bounded-timing',
      message:
        'readUltrasonicCm() поддержан только как exact built-in adapter ASA Lab поверх canonical GPIO/delay/pulseIn.',
    },
    {
      expression: /\b(?:millis|micros)\s*\(/gi,
      code: 'runtime-clock',
      message: 'millis()/micros() возвращают детерминированное время текущего шага симуляции.',
    },
    {
      expression: /(?:\+\+|--)/g,
      code: 'increment',
      message:
        'Инкремент и декремент поддерживаются отдельной командой, но не внутри выражений; bool-инкремент не поддерживается.',
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
