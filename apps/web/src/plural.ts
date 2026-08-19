/**
 * Русские числовые формы.
 *
 * «10 ученик» и «1 учеников» читаются как ошибка продукта, а числа стоят на
 * видном месте — в шапке класса и в сводке по классам.
 */
type Forms = Record<Intl.LDMLPluralRule, string>;

const rules = new Intl.PluralRules('ru-RU');

const LEARNER: Forms = {
  zero: 'учеников',
  one: 'ученик',
  two: 'ученика',
  few: 'ученика',
  many: 'учеников',
  other: 'ученика',
};

const CLASSROOM: Forms = {
  zero: 'классов',
  one: 'класс',
  two: 'класса',
  few: 'класса',
  many: 'классов',
  other: 'класса',
};

const WORK: Forms = {
  zero: 'работ',
  one: 'работа',
  two: 'работы',
  few: 'работы',
  many: 'работ',
  other: 'работы',
};

const TASK: Forms = {
  zero: 'заданий',
  one: 'задание',
  two: 'задания',
  few: 'задания',
  many: 'заданий',
  other: 'задания',
};

/** Только слово: число рядом набрано крупнее и живёт в своём теге. */
export function learnerWord(count: number): string {
  return LEARNER[rules.select(count)];
}

export function classroomWord(count: number): string {
  return CLASSROOM[rules.select(count)];
}

export function workWord(count: number): string {
  return WORK[rules.select(count)];
}

export function taskWord(count: number): string {
  return TASK[rules.select(count)];
}

/** Число и слово вместе — для строк в предложении. */
export function learnerCount(count: number): string {
  return `${count} ${learnerWord(count)}`;
}
