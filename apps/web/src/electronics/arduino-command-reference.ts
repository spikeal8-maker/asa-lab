import {
  ARDUINO_LANGUAGE_FEATURE_SUPPORT,
  ARDUINO_TEXT_COMMAND_SUPPORT,
  type ArduinoSupportStatus,
  type ArduinoLanguageFeature,
  type ArduinoTextCommand,
} from '@asa-lab/electronics';

export type ArduinoCommandCategory =
  | 'basics'
  | 'control'
  | 'logic'
  | 'types'
  | 'program'
  | 'io'
  | 'time'
  | 'math'
  | 'serial'
  | 'constant';

export interface ArduinoCommandReferenceEntry {
  readonly id: string;
  readonly command: string;
  readonly title: string;
  readonly signature: string;
  readonly category: ArduinoCommandCategory;
  readonly status: ArduinoSupportStatus;
  readonly summary: string;
  readonly limits: string;
  readonly example: string;
}

export const ARDUINO_SNIPPET_MIME = 'application/x-asa-arduino-snippet';
export const ARDUINO_EDITOR_PADDING_TOP = 10;

export interface ArduinoSnippetDropTarget {
  readonly lineIndex: number;
  readonly position: number;
  readonly top: number;
}

export const ARDUINO_COMMAND_CATEGORY_LABELS: Readonly<Record<ArduinoCommandCategory, string>> = {
  basics: 'Основы C++',
  control: 'Условия и циклы',
  logic: 'Сравнения и логика',
  types: 'Типы и переменные',
  program: 'Программа',
  io: 'Ввод и вывод',
  time: 'Время и звук',
  math: 'Математика',
  serial: 'Serial',
  constant: 'Константы',
};

const ARDUINO_COMMAND_CATEGORY_SEARCH_TERMS: Readonly<Record<ArduinoCommandCategory, string>> = {
  basics: 'основы c++ комментарий строка скобки точка запятая',
  control: 'условие если иначе цикл for while switch управление',
  logic: 'сравнение больше меньше равно не равно и или не логика',
  types: 'тип данные переменная число целое дробное boolean строка const',
  program: 'программа скетч setup loop',
  io: 'ввод вывод gpio pin',
  time: 'время таймер звук tone',
  math: 'математика число диапазон',
  serial: 'serial последовательный uart монитор порта',
  constant: 'константы уровни режимы',
};

type ArduinoCommandReferenceMetadata = Omit<
  ArduinoCommandReferenceEntry,
  'id' | 'command' | 'title' | 'status' | 'summary'
>;

const ARDUINO_COMMAND_TITLES = {
  setup: 'Настройка при запуске',
  loop: 'Повторяющаяся программа',
  pinMode: 'Режим цифрового вывода',
  digitalWrite: 'Запись цифрового уровня',
  digitalRead: 'Чтение цифрового входа',
  analogRead: 'Чтение аналогового входа',
  analogWrite: 'Запись ШИМ-уровня',
  delay: 'Пауза в миллисекундах',
  delayMicroseconds: 'Пауза в микросекундах',
  tone: 'Включить звуковой тон',
  noTone: 'Остановить звуковой тон',
  map: 'Перенести число в диапазон',
  constrain: 'Ограничить число',
  abs: 'Модуль числа',
  min: 'Меньшее из двух чисел',
  max: 'Большее из двух чисел',
  millis: 'Время симуляции',
  micros: 'Микросекундное время',
  pulseIn: 'Длительность импульса',
  random: 'Случайное число',
  randomSeed: 'Начальное значение случайных чисел',
  'Serial.begin': 'Открыть последовательный порт',
  'Serial.print': 'Напечатать без переноса',
  'Serial.println': 'Напечатать с новой строки',
  'Serial.available': 'Проверить входящие данные',
  'Serial.read': 'Прочитать входящие данные',
  HIGH: 'Высокий логический уровень',
  LOW: 'Низкий логический уровень',
  INPUT: 'Цифровой вход',
  INPUT_PULLUP: 'Вход с подтяжкой',
  OUTPUT: 'Цифровой выход',
  LED_BUILTIN: 'Встроенный светодиод',
} as const satisfies Readonly<Record<ArduinoTextCommand, string>>;

const REFERENCE_METADATA = {
  setup: {
    signature: 'void setup()',
    category: 'program',
    limits: 'Выполняется при запуске ограниченного runtime.',
    example: 'void setup() {\n  pinMode(13, OUTPUT);\n}',
  },
  loop: {
    signature: 'void loop()',
    category: 'program',
    limits: 'Повторяется по виртуальному времени симуляции.',
    example: 'void loop() {\n  digitalWrite(13, HIGH);\n}',
  },
  pinMode: {
    signature: 'pinMode(pin, mode)',
    category: 'io',
    limits: 'Цифровые выводы D0–D13; INPUT, INPUT_PULLUP или OUTPUT.',
    example: 'pinMode(2, INPUT_PULLUP);',
  },
  digitalWrite: {
    signature: 'digitalWrite(pin, level)',
    category: 'io',
    limits: 'D0–D13; уровень LOW или HIGH.',
    example: 'digitalWrite(13, HIGH);',
  },
  digitalRead: {
    signature: 'digitalRead(pin)',
    category: 'io',
    limits: 'D0–D13; результат LOW или HIGH.',
    example: 'int pressed = digitalRead(2);',
  },
  analogRead: {
    signature: 'analogRead(pin)',
    category: 'io',
    limits: 'Аналоговые входы A0–A5; результат 0–1023.',
    example: 'int value = analogRead(A0);',
  },
  analogWrite: {
    signature: 'analogWrite(pin, value)',
    category: 'io',
    limits: 'D3, D5, D6, D9, D10, D11; значение 0–255, пока как среднее DC.',
    example: 'analogWrite(9, 128);',
  },
  delay: {
    signature: 'delay(milliseconds)',
    category: 'time',
    limits: 'Неотрицательное число миллисекунд виртуального времени.',
    example: 'delay(1000);',
  },
  delayMicroseconds: {
    signature: 'delayMicroseconds(microseconds)',
    category: 'time',
    limits: 'Ограниченная временная модель, без полного AVR-таймера.',
    example: 'delayMicroseconds(50);',
  },
  tone: {
    signature: 'tone(pin, frequency[, duration])',
    category: 'time',
    limits: 'D0–D13; 1–20000 Гц; поддерживаемая звуковая нагрузка.',
    example: 'tone(8, 440, 500);',
  },
  noTone: {
    signature: 'noTone(pin)',
    category: 'time',
    limits: 'Останавливает tone() на указанном цифровом выводе.',
    example: 'noTone(8);',
  },
  map: {
    signature: 'map(value, fromLow, fromHigh, toLow, toHigh)',
    category: 'math',
    limits: 'Целочисленное линейное преобразование диапазона.',
    example: 'int pwm = map(sensor, 0, 1023, 0, 255);',
  },
  constrain: {
    signature: 'constrain(value, minimum, maximum)',
    category: 'math',
    limits: 'Ограничивает число указанными границами.',
    example: 'value = constrain(value, 0, 255);',
  },
  abs: {
    signature: 'abs(value)',
    category: 'math',
    limits: 'Числовое абсолютное значение.',
    example: 'int magnitude = abs(value);',
  },
  min: {
    signature: 'min(left, right)',
    category: 'math',
    limits: 'Возвращает меньшее числовое значение.',
    example: 'int limited = min(value, 255);',
  },
  max: {
    signature: 'max(left, right)',
    category: 'math',
    limits: 'Возвращает большее числовое значение.',
    example: 'int limited = max(value, 0);',
  },
  millis: {
    signature: 'millis()',
    category: 'time',
    limits: 'Время текущего шага симуляции, не счётчик инструкций AVR.',
    example: 'unsigned long now = millis();',
  },
  micros: {
    signature: 'micros()',
    category: 'time',
    limits: 'Микросекундные часы ещё не исполняются.',
    example: 'unsigned long now = micros();',
  },
  pulseIn: {
    signature: 'pulseIn(pin, level[, timeout])',
    category: 'time',
    limits: 'Измерение длительности импульса ещё не исполняется.',
    example: 'long width = pulseIn(7, HIGH);',
  },
  random: {
    signature: 'random([minimum,] maximum)',
    category: 'math',
    limits: 'Seeded deterministic random ещё не реализован.',
    example: 'long value = random(0, 100);',
  },
  randomSeed: {
    signature: 'randomSeed(seed)',
    category: 'math',
    limits: 'Seeded deterministic random ещё не реализован.',
    example: 'randomSeed(42);',
  },
  'Serial.begin': {
    signature: 'Serial.begin(baudRate)',
    category: 'serial',
    limits: 'Монитор пока не связан с UART runtime.',
    example: 'Serial.begin(9600);',
  },
  'Serial.print': {
    signature: 'Serial.print(value)',
    category: 'serial',
    limits: 'Вывод в монитор пока не исполняется.',
    example: 'Serial.print(value);',
  },
  'Serial.println': {
    signature: 'Serial.println(value)',
    category: 'serial',
    limits: 'Вывод в монитор пока не исполняется.',
    example: 'Serial.println(value);',
  },
  'Serial.available': {
    signature: 'Serial.available()',
    category: 'serial',
    limits: 'Очередь входа Serial пока не реализована.',
    example: 'if (Serial.available()) { }',
  },
  'Serial.read': {
    signature: 'Serial.read()',
    category: 'serial',
    limits: 'Очередь входа Serial пока не реализована.',
    example: 'int incoming = Serial.read();',
  },
  HIGH: {
    signature: 'HIGH',
    category: 'constant',
    limits: 'Высокий цифровой уровень.',
    example: 'digitalWrite(13, HIGH);',
  },
  LOW: {
    signature: 'LOW',
    category: 'constant',
    limits: 'Низкий цифровой уровень.',
    example: 'digitalWrite(13, LOW);',
  },
  INPUT: {
    signature: 'INPUT',
    category: 'constant',
    limits: 'Высокоомный цифровой вход.',
    example: 'pinMode(2, INPUT);',
  },
  INPUT_PULLUP: {
    signature: 'INPUT_PULLUP',
    category: 'constant',
    limits: 'Внутренняя подтяжка моделируется как 20 кОм.',
    example: 'pinMode(2, INPUT_PULLUP);',
  },
  OUTPUT: {
    signature: 'OUTPUT',
    category: 'constant',
    limits: 'Режим цифрового выхода.',
    example: 'pinMode(13, OUTPUT);',
  },
  LED_BUILTIN: {
    signature: 'LED_BUILTIN',
    category: 'constant',
    limits: 'Встроенный светодиод Uno на D13.',
    example: 'digitalWrite(LED_BUILTIN, HIGH);',
  },
} as const satisfies Readonly<Record<ArduinoTextCommand, ArduinoCommandReferenceMetadata>>;

type ArduinoLanguageReferenceMetadata = Omit<
  ArduinoCommandReferenceEntry,
  'id' | 'status' | 'summary'
>;

const LANGUAGE_REFERENCE_METADATA = {
  comment: {
    command: 'comment',
    title: 'Комментарий',
    signature: '// текст или /* текст */',
    category: 'basics',
    limits: 'Комментарий нужен человеку и не меняет электрический расчёт.',
    example: '// Включаем светодиод на D13',
  },
  statement: {
    command: 'statement',
    title: 'Строка команды и блок',
    signature: 'команда;  { команды }',
    category: 'basics',
    limits:
      'Простая команда заканчивается точкой с запятой; фигурные скобки нужны вокруг тела setup, loop, if и поддерживаемых циклов.',
    example: 'digitalWrite(13, HIGH);',
  },
  'type-int': {
    command: 'int',
    title: 'Целое число',
    signature: 'int имя = значение;',
    category: 'types',
    limits:
      'Подходит для показаний 0–1023 и других целых значений; переполнение AVR пока не имитируется.',
    example: 'int sensor = analogRead(A0);',
  },
  'type-long': {
    command: 'long',
    title: 'Большое целое число',
    signature: 'long / unsigned long',
    category: 'types',
    limits:
      'Используйте для времени и больших целых чисел; точная 32-битная арифметика AVR пока не имитируется.',
    example: 'unsigned long now = millis();',
  },
  'type-float': {
    command: 'float',
    title: 'Дробное число',
    signature: 'float / double',
    category: 'types',
    limits:
      'Дроби вычисляются, но различие float и double как на настоящем Uno не воспроизводится.',
    example: 'float voltage = analogRead(A0) * 5.0 / 1023.0;',
  },
  'type-bool': {
    command: 'bool',
    title: 'Логическое значение',
    signature: 'bool имя = true;',
    category: 'types',
    limits: 'true соответствует 1, false — 0; значение хранится только в текущем пересчёте.',
    example: 'bool pressed = digitalRead(2) == LOW;',
  },
  'type-byte': {
    command: 'byte',
    title: 'Число для байта',
    signature: 'byte имя = значение;',
    category: 'types',
    limits:
      'Объявление работает, но автоматическое ограничение диапазоном 0–255 пока не моделируется.',
    example: 'byte brightness = 128;',
  },
  'type-text': {
    command: 'String',
    title: 'Символы и строки',
    signature: 'char / String',
    category: 'types',
    limits:
      'Текст можно написать в редакторе, но электрический runtime пока не исполняет строковые операции.',
    example: 'String message = "Привет";',
  },
  constant: {
    command: 'const',
    title: 'Именованная константа',
    signature: 'const тип имя = значение;',
    category: 'types',
    limits: 'Значение читается, но runtime пока не запрещает его случайное изменение позже.',
    example: 'const int ledPin = 13;',
  },
  assignment: {
    command: 'assignment',
    title: 'Записать или изменить переменную',
    signature: '=  +=  -=  *=  /=',
    category: 'types',
    limits: 'Переменные не сохраняют состояние между независимыми пересчётами схемы.',
    example: 'counter += 1;',
  },
  if: {
    command: 'if',
    title: 'Выполнить при условии',
    signature: 'if (условие) { ... }',
    category: 'control',
    limits: 'Тело выполняется, только когда числовое условие не равно нулю.',
    example: 'if (digitalRead(2) == HIGH) {\n  digitalWrite(13, HIGH);\n}',
  },
  'if-else': {
    command: 'if-else',
    title: 'Выбрать одну из двух ветвей',
    signature: 'if (...) { ... } else { ... }',
    category: 'control',
    limits:
      'Поддерживается обычный if/else с фигурными скобками; цепочка else if пока не подтверждена.',
    example:
      'if (digitalRead(2) == HIGH) {\n  digitalWrite(13, HIGH);\n} else {\n  digitalWrite(13, LOW);\n}',
  },
  for: {
    command: 'for',
    title: 'Цикл со счётчиком',
    signature: 'for (начало; условие; шаг) { ... }',
    category: 'control',
    limits:
      'Для безопасности тело выполняется один раз; это не полноценный цикл настоящего контроллера.',
    example: 'for (int i = 0; i < 3; i += 1) {\n  digitalWrite(13, HIGH);\n}',
  },
  while: {
    command: 'while',
    title: 'Цикл пока условие истинно',
    signature: 'while (условие) { ... }',
    category: 'control',
    limits: 'Условие проверяется, но тело выполняется не более одного раза за расчёт.',
    example: 'while (digitalRead(2) == HIGH) {\n  digitalWrite(13, HIGH);\n}',
  },
  switch: {
    command: 'switch',
    title: 'Выбор из нескольких вариантов',
    signature: 'switch (value) { case ... }',
    category: 'control',
    limits: 'Редактор показывает синтаксис, но симуляция такую конструкцию сейчас блокирует.',
    example: 'switch (value) {\n  case 1: digitalWrite(13, HIGH); break;\n}',
  },
  'do-while': {
    command: 'do-while',
    title: 'Цикл с проверкой в конце',
    signature: 'do { ... } while (...);',
    category: 'control',
    limits: 'Конструкция пока не исполняется электрическим runtime.',
    example: 'do {\n  counter += 1;\n} while (counter < 3);',
  },
  comparison: {
    command: 'comparison',
    title: 'Больше и меньше',
    signature: '<  <=  >  >=',
    category: 'logic',
    limits: 'Результат сравнения — 1 (истина) или 0 (ложь).',
    example: 'if (analogRead(A0) >= 512) {\n  digitalWrite(13, HIGH);\n}',
  },
  equality: {
    command: 'equality',
    title: 'Равно и не равно',
    signature: '==  !=',
    category: 'logic',
    limits: 'Для сравнения используйте ==; один знак = записывает значение в переменную.',
    example: 'bool released = digitalRead(2) != LOW;',
  },
  'logical-and': {
    command: 'logical-and',
    title: 'Логическое И',
    signature: 'условие1 && условие2',
    category: 'logic',
    limits: 'Истина получается, только когда истинны оба условия.',
    example: 'if (sensor > 300 && sensor < 700) {\n  digitalWrite(13, HIGH);\n}',
  },
  'logical-or': {
    command: 'logical-or',
    title: 'Логическое ИЛИ',
    signature: 'условие1 || условие2',
    category: 'logic',
    limits: 'Истина получается, когда истинно хотя бы одно условие.',
    example: 'if (button1 == HIGH || button2 == HIGH) {\n  digitalWrite(13, HIGH);\n}',
  },
  'logical-not': {
    command: 'logical-not',
    title: 'Логическое НЕ',
    signature: '!условие',
    category: 'logic',
    limits: 'Меняет истину на ложь и ложь на истину.',
    example: 'if (!pressed) {\n  digitalWrite(13, LOW);\n}',
  },
  arithmetic: {
    command: 'arithmetic',
    title: 'Арифметические действия',
    signature: '+  -  *  /  %',
    category: 'math',
    limits: 'Деление и остаток от деления на ноль дают безопасный ноль, а не ошибку платы.',
    example: 'int average = (left + right) / 2;',
  },
} as const satisfies Readonly<Record<ArduinoLanguageFeature, ArduinoLanguageReferenceMetadata>>;

export const ARDUINO_LANGUAGE_REFERENCE: readonly ArduinoCommandReferenceEntry[] = (
  Object.keys(ARDUINO_LANGUAGE_FEATURE_SUPPORT) as ArduinoLanguageFeature[]
).map((feature) => ({
  id: `language:${feature}`,
  ...LANGUAGE_REFERENCE_METADATA[feature],
  ...ARDUINO_LANGUAGE_FEATURE_SUPPORT[feature],
}));

export const ARDUINO_COMMAND_REFERENCE: readonly ArduinoCommandReferenceEntry[] = (
  Object.keys(ARDUINO_TEXT_COMMAND_SUPPORT) as ArduinoTextCommand[]
).map((command) => ({
  id: `command:${command}`,
  command,
  title: ARDUINO_COMMAND_TITLES[command],
  ...REFERENCE_METADATA[command],
  ...ARDUINO_TEXT_COMMAND_SUPPORT[command],
}));

export const ARDUINO_REFERENCE_ENTRIES: readonly ArduinoCommandReferenceEntry[] = [
  ...ARDUINO_LANGUAGE_REFERENCE,
  ...ARDUINO_COMMAND_REFERENCE,
];

export function arduinoSupportStatusLabel(status: ArduinoSupportStatus): string {
  if (status === 'supported') return 'Работает';
  if (status === 'limited') return 'Ограничено';
  return 'Пока не работает';
}

export function filterArduinoCommandReference(
  query: string,
  category: ArduinoCommandCategory | 'all',
): readonly ArduinoCommandReferenceEntry[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  return ARDUINO_REFERENCE_ENTRIES.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (!needle) return true;
    return [
      entry.command,
      entry.title,
      entry.signature,
      entry.summary,
      entry.limits,
      ARDUINO_COMMAND_CATEGORY_LABELS[entry.category],
      ARDUINO_COMMAND_CATEGORY_SEARCH_TERMS[entry.category],
    ]
      .join(' ')
      .toLocaleLowerCase('ru')
      .includes(needle);
  });
}

export function insertArduinoSnippet(
  source: string,
  snippet: string,
  position: number,
): { readonly source: string; readonly cursor: number } {
  const at = Math.max(0, Math.min(source.length, Math.trunc(position)));
  const before = source.slice(0, at);
  const after = source.slice(at);
  const leadingBreak = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const trailingBreak = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
  const insertion = `${leadingBreak}${snippet}${trailingBreak}`;
  return {
    source: `${before}${insertion}${after}`,
    cursor: before.length + insertion.length,
  };
}

export function arduinoSnippetDropTarget(
  source: string,
  pointerY: number,
  scrollTop: number,
  fontSize: number,
): ArduinoSnippetDropTarget {
  const lineHeight = Math.max(1, fontSize * 1.45);
  const lineCount = source.split('\n').length;
  const lineIndex = Math.max(
    0,
    Math.min(
      lineCount,
      Math.round((pointerY + scrollTop - ARDUINO_EDITOR_PADDING_TOP) / lineHeight),
    ),
  );
  let position = source.length;
  if (lineIndex < lineCount) {
    position = 0;
    for (let index = 0; index < lineIndex; index += 1) {
      position = source.indexOf('\n', position) + 1;
    }
  }
  return {
    lineIndex,
    position,
    top: ARDUINO_EDITOR_PADDING_TOP + lineIndex * lineHeight - scrollTop,
  };
}
