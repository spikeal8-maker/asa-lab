import {
  ARDUINO_TEXT_COMMAND_SUPPORT,
  type ArduinoSupportStatus,
  type ArduinoTextCommand,
} from '@asa-lab/electronics';

export type ArduinoCommandCategory = 'program' | 'io' | 'time' | 'math' | 'serial' | 'constant';

export interface ArduinoCommandReferenceEntry {
  readonly command: ArduinoTextCommand;
  readonly signature: string;
  readonly category: ArduinoCommandCategory;
  readonly status: ArduinoSupportStatus;
  readonly summary: string;
  readonly limits: string;
  readonly example: string;
}

export const ARDUINO_COMMAND_CATEGORY_LABELS: Readonly<Record<ArduinoCommandCategory, string>> = {
  program: 'Программа',
  io: 'Ввод и вывод',
  time: 'Время и звук',
  math: 'Математика',
  serial: 'Serial',
  constant: 'Константы',
};

const ARDUINO_COMMAND_CATEGORY_SEARCH_TERMS: Readonly<Record<ArduinoCommandCategory, string>> = {
  program: 'программа скетч setup loop',
  io: 'ввод вывод gpio pin',
  time: 'время таймер звук tone',
  math: 'математика число диапазон',
  serial: 'serial последовательный uart монитор порта',
  constant: 'константы уровни режимы',
};

type ArduinoCommandReferenceMetadata = Omit<
  ArduinoCommandReferenceEntry,
  'command' | 'status' | 'summary'
>;

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

export const ARDUINO_COMMAND_REFERENCE: readonly ArduinoCommandReferenceEntry[] = (
  Object.keys(ARDUINO_TEXT_COMMAND_SUPPORT) as ArduinoTextCommand[]
).map((command) => ({
  command,
  ...REFERENCE_METADATA[command],
  ...ARDUINO_TEXT_COMMAND_SUPPORT[command],
}));

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
  return ARDUINO_COMMAND_REFERENCE.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false;
    if (!needle) return true;
    return [
      entry.command,
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
