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
  asa_setup: LIMITED('setup() пересчитывается детерминированно, без памяти настоящего МК.'),
  asa_loop: LIMITED('loop() моделируется ограниченным циклом, а не полным AVR-рантаймом.'),
  asa_wait: SUPPORTED('Задержка управляет фазой виртуального времени симуляции.'),
  asa_repeat: LIMITED('Тело цикла исполняется одним ограниченным проходом.'),
  asa_forever: LIMITED('Тело цикла исполняется одним ограниченным проходом.'),
  asa_if: SUPPORTED('Условие вычисляется электрическим рантаймом.'),
  asa_if_else: SUPPORTED('Одна из ветвей выбирается по вычисленному условию.'),
  asa_while: LIMITED('Тело цикла исполняется одним ограниченным проходом.'),
  asa_for: LIMITED('Тело цикла исполняется одним ограниченным проходом.'),
  asa_builtin_led: SUPPORTED('Управляет цифровым выводом D13.'),
  asa_digital_write: SUPPORTED('Устанавливает цифровой уровень на D0–D13.'),
  asa_analog_write: LIMITED('ШИМ представлен средним постоянным напряжением.'),
  asa_servo_write: UNSUPPORTED('Сервопривод ещё не связан с Arduino-рантаймом.'),
  asa_tone: LIMITED('Частота передаётся пьезоэлементу, но не моделируется как общий сигнал.'),
  asa_play_note: LIMITED('Частота передаётся пьезоэлементу, но не моделируется как общий сигнал.'),
  asa_no_tone: LIMITED('Останавливает поддерживаемый ограниченный tone()-выход.'),
  asa_serial_print: UNSUPPORTED('Монитор порта пока не подключён к Serial в программе.'),
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
  asa_ultrasonic: UNSUPPORTED('pulseIn() и временная модель датчика ещё не реализованы.'),
  asa_pulse_in: UNSUPPORTED('Измерение длительности импульса ещё не реализовано.'),
  asa_millis: LIMITED('Возвращает детерминированное время текущего шага симуляции.'),
  asa_temperature: SUPPORTED('Преобразует поддерживаемое analogRead() по формуле TMP36.'),
  asa_servo_read: UNSUPPORTED('Сервопривод ещё не связан с Arduino-рантаймом.'),
  asa_serial_available: UNSUPPORTED('Монитор порта пока не подключён к Serial в программе.'),
  asa_serial_read: UNSUPPORTED('Монитор порта пока не подключён к Serial в программе.'),
  asa_ir_read: UNSUPPORTED('Протокол ИК-приёмника ещё не декодируется.'),
  asa_number: SUPPORTED('Числовой литерал поддерживается.'),
  asa_text: UNSUPPORTED('Строковые значения ещё не исполняются электрическим рантаймом.'),
  asa_math_add: SUPPORTED('Сложение поддерживается.'),
  asa_math_minus: SUPPORTED('Вычитание поддерживается.'),
  asa_math_multiply: SUPPORTED('Умножение поддерживается.'),
  asa_math_divide: SUPPORTED('Деление поддерживается; деление на ноль даёт безопасный ноль.'),
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
  asa_var_get: LIMITED('Переменная живёт только внутри одного пересчёта симуляции.'),
  asa_var_set: LIMITED('Переменная живёт только внутри одного пересчёта симуляции.'),
  asa_var_change: LIMITED('Переменная живёт только внутри одного пересчёта симуляции.'),
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
  tone: LIMITED('Работает со звуковой нагрузкой без общей временной формы сигнала.'),
  noTone: LIMITED('Останавливает поддерживаемый ограниченный tone()-выход.'),
  map: SUPPORTED('Числовое преобразование диапазона поддерживается.'),
  constrain: SUPPORTED('Числовое ограничение диапазона поддерживается.'),
  abs: SUPPORTED('Абсолютное значение поддерживается.'),
  min: SUPPORTED('Минимум поддерживается.'),
  max: SUPPORTED('Максимум поддерживается.'),
  millis: LIMITED('Возвращает время текущего шага симуляции.'),
  micros: UNSUPPORTED('Микросекундные часы ещё не моделируются.'),
  pulseIn: UNSUPPORTED('Измерение длительности импульса ещё не реализовано.'),
  random: UNSUPPORTED('Случайные числа не входят в детерминированный рантайм.'),
  randomSeed: UNSUPPORTED('Случайные числа не входят в детерминированный рантайм.'),
  'Serial.begin': UNSUPPORTED('Serial Monitor ещё не связан с программой.'),
  'Serial.print': UNSUPPORTED('Serial Monitor ещё не связан с программой.'),
  'Serial.println': UNSUPPORTED('Serial Monitor ещё не связан с программой.'),
  'Serial.available': UNSUPPORTED('Serial Monitor ещё не связан с программой.'),
  'Serial.read': UNSUPPORTED('Serial Monitor ещё не связан с программой.'),
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
  'type-int': LIMITED('Целое число исполняется как числовое значение без AVR-переполнения.'),
  'type-long': LIMITED('long и unsigned long исполняются без точной AVR-разрядности.'),
  'type-float': LIMITED('float и double исполняются общей числовой моделью JavaScript.'),
  'type-bool': LIMITED('bool и boolean исполняются как числовые 0 и 1.'),
  'type-byte': LIMITED('byte исполняется как число без автоматического ограничения 0–255.'),
  'type-text': UNSUPPORTED('char, String и операции со строками ещё не исполняются.'),
  constant: LIMITED(
    'const принимается, но запрет последующего присваивания пока не контролируется.',
  ),
  assignment: LIMITED('Переменные живут только внутри одного детерминированного пересчёта.'),
  if: SUPPORTED('Условие вычисляется, и исполняется подходящая ветвь.'),
  'if-else': SUPPORTED('Исполняется ровно одна ветвь if/else.'),
  for: LIMITED(
    'Тело for исполняется одним ограниченным проходом; заголовок цикла не разворачивается.',
  ),
  while: LIMITED('Тело while исполняется не более одного раза за расчёт.'),
  switch: UNSUPPORTED('switch/case ещё не входит в подтверждённое подмножество.'),
  'do-while': UNSUPPORTED('do…while ещё не входит в подтверждённое подмножество.'),
  comparison: SUPPORTED('Поддерживаются <, <=, > и >=.'),
  equality: SUPPORTED('Поддерживаются == и !=.'),
  'logical-and': SUPPORTED('Логическое И && поддерживается.'),
  'logical-or': SUPPORTED('Логическое ИЛИ || поддерживается.'),
  'logical-not': SUPPORTED('Логическое НЕ ! поддерживается.'),
  arithmetic: SUPPORTED('Поддерживаются +, −, *, / и %; деление на ноль даёт безопасный ноль.'),
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
]);

const CONTROL_CALLS = new Set(['if', 'while', 'for', 'switch']);

const UNSUPPORTED_CALL_MESSAGES = new Map<string, string>([
  ['random', 'random() ещё не исполняется детерминированным рантаймом.'],
  ['randomseed', 'randomSeed() ещё не исполняется детерминированным рантаймом.'],
  ['micros', 'micros() ещё не моделируется.'],
  ['pulsein', 'pulseIn() и измерение длительности импульса ещё не реализованы.'],
  ['shiftin', 'shiftIn() ещё не исполняется.'],
  ['shiftout', 'shiftOut() ещё не исполняется.'],
  ['attachinterrupt', 'Прерывания ещё не моделируются.'],
  ['detachinterrupt', 'Прерывания ещё не моделируются.'],
  ['readultrasoniccm', 'Временная модель ультразвукового датчика ещё не реализована.'],
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

  for (const match of clean.matchAll(/^\s*#\s*(?:include|define|if|ifdef|ifndef|pragma)\b.*$/gim)) {
    const start = match.index ?? 0;
    add(
      'preprocessor',
      'unsupported',
      start,
      Math.max(1, match[0].trim().length),
      'Директивы препроцессора и внешние библиотеки пока не исполняются.',
    );
  }

  const memberCallRanges: Array<{ readonly start: number; readonly end: number }> = [];
  for (const match of clean.matchAll(/\b([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\(/g)) {
    const start = match.index ?? 0;
    memberCallRanges.push({ start, end: start + match[0].length });
    add(
      'member-call',
      'unsupported',
      start,
      Math.max(1, match[0].length - 1),
      `${match[1]}.${match[2]}() пока не исполняется Arduino-рантаймом.`,
    );
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
      message: 'Цикл исполняется одним ограниченным проходом.',
    },
    {
      expression: /\banalogWrite\s*\(/gi,
      code: 'averaged-pwm',
      message: 'ШИМ представлен средним постоянным напряжением.',
    },
    {
      expression: /\b(?:tone|noTone)\s*\(/gi,
      code: 'bounded-timing',
      message: 'Звуковой сигнал передаётся нагрузке без полной временной формы в общем solver.',
    },
    {
      expression: /\bmillis\s*\(/gi,
      code: 'runtime-clock',
      message: 'millis() возвращает время текущего шага симуляции.',
    },
    {
      expression: /(?:\+\+|--)/g,
      code: 'increment',
      message: 'Инкремент и декремент учитываются только внутри ограниченной модели цикла.',
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
