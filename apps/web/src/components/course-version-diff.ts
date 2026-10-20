import type { PublishedAuthorVersion, PublishedCoursePin } from '../api';

export type CourseVersionDiffCategory =
  'Курс' | 'Разделы' | 'Уроки' | 'Блоки' | 'Задания' | 'Политика';

export type CourseVersionValue =
  { state: 'value'; value: unknown } | { state: 'missing' | 'null' | 'unavailable' };

export interface CourseVersionChange {
  category: CourseVersionDiffCategory;
  kind: 'added' | 'removed' | 'moved' | 'changed' | 'unavailable';
  path: string;
  field: string;
  before: CourseVersionValue;
  after: CourseVersionValue;
}

type RecordValue = Record<string, unknown>;
interface Element {
  id: string;
  parent: string;
  index: number;
  path: string;
  parentPath: string;
  body: RecordValue;
}
interface Practice {
  id: string;
  path: string;
  reference: unknown;
  pin: PublishedCoursePin | undefined;
  frozen: RecordValue;
}
const categories: CourseVersionDiffCategory[] = [
  'Курс',
  'Разделы',
  'Уроки',
  'Блоки',
  'Задания',
  'Политика',
];
const policyNames: Record<string, string> = {
  attemptPolicy: 'Попытки и время выполнения',
  resultSelectionPolicy: 'Выбор результата',
  completionPolicy: 'Завершение задания',
  latePolicy: 'После срока',
  assessmentPolicy: 'Оценивание',
  feedbackReleasePolicy: 'Показ замечаний',
};
const fieldNames: Record<string, string> = {
  maxAttempts: 'Число попыток',
  window: 'Окно выполнения',
  timeLimitMinutes: 'Время на попытку, мин',
  mode: 'Правило',
  dueAt: 'Срок',
  availableFrom: 'Доступно с',
  availableUntil: 'Доступно до',
  opensAt: 'Начало доступа',
  closesAt: 'Окончание доступа',
  timeZone: 'Часовой пояс',
  graceMinutes: 'Дополнительное время, мин',
  allowLate: 'Разрешать опоздание',
  passThresholdBasisPoints: 'Порог успешного выполнения, сотые доли процента',
  required: 'Обязательно',
  kind: 'Вид',
  status: 'Состояние',
  type: 'Вид материала',
  text: 'Текст',
  items: 'Пункты',
  href: 'Адрес ссылки',
  alt: 'Описание изображения',
  name: 'Название файла',
  contentHash: 'Отпечаток материала',
};
const valueNames: Record<string, string> = {
  project: 'Практическое задание',
  manual: 'Проверка преподавателем',
  material: 'Теория',
  assignment: 'Практика',
  electronics: 'Электроника',
  'three-d': '3D',
  blocks: 'Блочное программирование',
  ungraded: 'Без оценки',
  completion: 'Выполнение',
  graded: 'Баллы',
  paragraph: 'Текст',
  heading: 'Заголовок',
  callout: 'Примечание',
  image: 'Изображение',
  video: 'Видео',
  audio: 'Аудио',
  file: 'Файл',
  code: 'Код',
  formula: 'Формула',
  table: 'Таблица',
  divider: 'Разделитель',
  activity: 'Практическое задание',
  'manual-material': 'Учебный материал',
  note: 'Примечание',
  tip: 'Подсказка',
  warning: 'Предупреждение',
  allow_until_close: 'Разрешать до закрытия',
  allow_mark_late: 'Разрешать с отметкой опоздания',
  block_at_due: 'Запретить после срока',
  immediate: 'Сразу',
  after_close: 'После закрытия',
  after_due: 'После срока',
  after_review: 'После проверки',
  never: 'Не показывать',
  latest_accepted: 'Последняя принятая попытка',
  first: 'Первая попытка',
  latest: 'Последняя попытка',
  best: 'Лучший результат',
  teacher_selected: 'Выбор преподавателя',
  accepted: 'После принятия преподавателем',
  submitted: 'После сдачи',
  manual_review: 'Проверка преподавателем',
  automatic: 'Автоматическая проверка',
  automatic_completion: 'Автоматическое подтверждение выполнения',
};

function lookup(names: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(names, key) ? names[key] : undefined;
}

function object(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function list(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + stable(object(value)[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function value(input: unknown): CourseVersionValue {
  return input === undefined
    ? { state: 'missing' }
    : input === null
      ? { state: 'null' }
      : { state: 'value', value: input };
}
function read(input: RecordValue, key: string): CourseVersionValue {
  return Object.hasOwn(input, key) ? value(input[key]) : { state: 'missing' };
}
function label(input: unknown, fallback: string): string {
  return typeof input === 'string' && input.trim() ? input : fallback;
}
function blockLabel(block: RecordValue, index: number): string {
  const title = label(block['text'] ?? block['title'] ?? block['label'] ?? block['caption'], '');
  const kind = lookup(valueNames, String(block['type'])) ?? 'Блок';
  return `${kind} ${index + 1}${title ? ` «${title.slice(0, 80)}${title.length > 80 ? '…' : ''}»` : ''}`;
}

/** A common insertion/deletion never makes the surviving suffix look moved. */
function movedIds(before: string[], after: string[]): Set<string> {
  const common = new Set(before.filter((id) => after.includes(id)));
  const a = before.filter((id) => common.has(id));
  const b = after.filter((id) => common.has(id));
  const lengths = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i]![j] =
        a[i] === b[j]
          ? 1 + lengths[i + 1]![j + 1]!
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const retained = new Set<string>();
  for (let i = 0, j = 0; i < a.length && j < b.length;)
    if (a[i] === b[j]) {
      retained.add(a[i]!);
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) i++;
    else j++;
  return new Set(a.filter((id) => !retained.has(id)));
}

function outline(version: PublishedAuthorVersion) {
  const sections: Element[] = [],
    lessons: Element[] = [],
    blocks: Element[] = [];
  const practices: Practice[] = [];
  const course = object(
    version.outline?.course ?? {
      title: version.title,
      summary: version.instructions,
    },
  );
  const coursePath = `Курс «${label(course['title'], 'Без названия')}»`;
  const pins = new Map((version.pinnedActivities ?? []).map((pin) => [pin.pointer, pin]));
  list(version.outline?.sections).forEach((section, sectionIndex) => {
    const sectionId = String(section['sourceSectionId'] ?? `missing-section-${sectionIndex}`);
    const sectionPath = `${coursePath} → Раздел «${label(section['title'], 'Без названия')}»`;
    sections.push({
      id: sectionId,
      parent: 'course',
      index: sectionIndex,
      path: sectionPath,
      parentPath: coursePath,
      body: section,
    });
    list(section['lessons']).forEach((lesson, lessonIndex) => {
      const lessonId = String(
        lesson['sourceLessonId'] ?? `missing-lesson-${sectionIndex}-${lessonIndex}`,
      );
      const lessonPath = `${sectionPath} → Урок «${label(lesson['title'], 'Без названия')}»`;
      const pointer = `/sections/${sectionIndex}/lessons/${lessonIndex}`;
      lessons.push({
        id: lessonId,
        parent: sectionId,
        index: lessonIndex,
        path: lessonPath,
        parentPath: sectionPath,
        body: lesson,
      });
      const assignment = object(lesson['assignment']);
      if (
        lesson['kind'] === 'assignment' ||
        Object.keys(assignment).length > 0 ||
        lesson['learningActivityVersionId'] != null
      ) {
        const pin = pins.get(pointer + '/assignment');
        practices.push({
          id: lessonId + '/assignment',
          path: lessonPath + ' → Практика',
          reference:
            lesson['learningActivityVersionId'] ??
            assignment['learningActivityVersionId'] ??
            assignment['sourceAssignmentId'],
          pin,
          frozen: assignment,
        });
      }
      list(lesson['blocks']).forEach((block, blockIndex) => {
        // IDs are unique within a lesson, not necessarily across the course.
        const id = lessonId + '/block/' + String(block['id'] ?? `missing-${blockIndex}`);
        const path = lessonPath + ' → ' + blockLabel(block, blockIndex);
        blocks.push({
          id,
          parent: lessonId,
          index: blockIndex,
          path,
          parentPath: lessonPath,
          body: block,
        });
        if (block['type'] === 'activity' || block['type'] === 'manual-material')
          practices.push({
            id,
            path,
            reference: block['learningActivityVersionId'],
            pin: pins.get(pointer + '/blocks/' + blockIndex),
            frozen: {},
          });
      });
    });
  });
  return { course, coursePath, sections, lessons, blocks, practices };
}

export function courseVersionChanges(
  left: PublishedAuthorVersion,
  right: PublishedAuthorVersion,
): CourseVersionChange[] {
  const changes: CourseVersionChange[] = [];
  const before = outline(left),
    after = outline(right);
  function add(
    category: CourseVersionDiffCategory,
    path: string,
    field: string,
    oldValue: CourseVersionValue,
    newValue: CourseVersionValue,
    kind: CourseVersionChange['kind'] = 'changed',
    force = false,
  ) {
    if (force || stable(oldValue) !== stable(newValue))
      changes.push({ category, kind, path, field, before: oldValue, after: newValue });
  }
  function fields(
    category: CourseVersionDiffCategory,
    path: string,
    a: RecordValue,
    b: RecordValue,
    names: Record<string, string>,
  ) {
    for (const [key, name] of Object.entries(names))
      add(category, path, name, read(a, key), read(b, key));
  }
  fields('Курс', after.coursePath, before.course, after.course, {
    title: 'Название',
    summary: 'Описание',
    ageBand: 'Возрастная группа',
  });
  if (!Array.isArray(left.outline?.sections) || !Array.isArray(right.outline?.sections))
    add(
      'Курс',
      after.coursePath,
      'Историческое содержание',
      { state: 'unavailable' },
      { state: 'unavailable' },
      'unavailable',
      true,
    );

  function elements(
    category: CourseVersionDiffCategory,
    a: Element[],
    b: Element[],
    names: Record<string, string>,
  ) {
    const old = new Map(a.map((item) => [item.id, item])),
      next = new Map(b.map((item) => [item.id, item]));
    const moved = new Set<string>();
    for (const parent of new Set([...a, ...b].map((item) => item.parent))) {
      const previousIds = a
        .filter((item) => item.parent === parent && next.get(item.id)?.parent === parent)
        .map((item) => item.id);
      const nextIds = b
        .filter((item) => item.parent === parent && old.get(item.id)?.parent === parent)
        .map((item) => item.id);
      for (const id of movedIds(previousIds, nextIds)) moved.add(id);
    }
    function snapshot(item: Element): CourseVersionValue {
      const details: RecordValue = { Положение: `${item.parentPath} · позиция ${item.index + 1}` };
      for (const [key, name] of Object.entries(names))
        if (Object.hasOwn(item.body, key)) details[name] = item.body[key];
      return value(details);
    }
    for (const item of a)
      if (!next.has(item.id))
        add(category, item.path, 'Элемент', snapshot(item), { state: 'missing' }, 'removed');
    for (const item of b) {
      const prior = old.get(item.id);
      if (!prior) {
        add(category, item.path, 'Элемент', { state: 'missing' }, snapshot(item), 'added');
        continue;
      }
      if (prior.parent !== item.parent || moved.has(item.id))
        add(
          category,
          item.path,
          'Положение',
          value(`${prior.parentPath} · позиция ${prior.index + 1}`),
          value(`${item.parentPath} · позиция ${item.index + 1}`),
          'moved',
        );
      fields(category, item.path, prior.body, item.body, names);
      if (category === 'Уроки')
        fields('Политика', item.path, prior.body, item.body, {
          estimatedMinutes: 'Продолжительность, мин',
        });
    }
  }
  elements('Разделы', before.sections, after.sections, { title: 'Название', summary: 'Описание' });
  elements('Уроки', before.lessons, after.lessons, {
    title: 'Название',
    summary: 'Описание',
    kind: 'Тип урока',
    content: 'Текст урока',
  });
  elements('Блоки', before.blocks, after.blocks, {
    type: 'Тип блока',
    text: 'Текст',
    level: 'Уровень заголовка',
    tone: 'Тип примечания',
    url: 'Адрес материала',
    alt: 'Описание изображения',
    caption: 'Подпись',
    title: 'Название',
    label: 'Название файла',
    language: 'Язык кода',
    rows: 'Ячейки таблицы',
    hidden: 'Скрыт',
  });

  function policies(path: string, a: CourseVersionValue, b: CourseVersionValue, name: string) {
    if (
      a.state === 'value' &&
      b.state === 'value' &&
      a.value !== null &&
      b.value !== null &&
      typeof a.value === 'object' &&
      typeof b.value === 'object' &&
      !Array.isArray(a.value) &&
      !Array.isArray(b.value)
    ) {
      const leftObject = object(a.value),
        rightObject = object(b.value);
      for (const key of Array.from(
        new Set([...Object.keys(leftObject), ...Object.keys(rightObject)]),
      ).sort())
        policies(
          path,
          read(leftObject, key),
          read(rightObject, key),
          name + ' · ' + (lookup(fieldNames, key) ?? key),
        );
    } else add('Политика', path, name, a, b);
  }
  const previous = new Map(before.practices.map((item) => [item.id, item]));
  const current = new Map(after.practices.map((item) => [item.id, item]));
  function exactPin(item: Practice | undefined): PublishedCoursePin | undefined {
    return item?.pin?.available && item.pin.versionId === item.reference ? item.pin : undefined;
  }
  function snapshotValue(
    item: Practice | undefined,
    pin: PublishedCoursePin | undefined,
    field: 'goal' | 'blocks',
  ): CourseVersionValue {
    if (!item) return { state: 'missing' };
    // Existing rows can be canonical and readable while predating either
    // immutable snapshot. Neither null nor [] establishes historical presence.
    const present = field === 'goal' ? pin?.goalSnapshotPresent : pin?.blocksSnapshotPresent;
    if (present !== true || (field === 'blocks' && !Array.isArray(pin?.blocks)))
      return { state: 'unavailable' };
    const stored = read(object(pin), field);
    return stored.state === 'missing' ? { state: 'unavailable' } : stored;
  }
  const referenceValue = (pin: PublishedCoursePin | undefined): CourseVersionValue =>
    pin
      ? value(`«${pin.title ?? 'Задание'}» · версия ${pin.versionNumber}`)
      : { state: 'unavailable' };
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const a = previous.get(id),
      b = current.get(id),
      path = (b ?? a)!.path;
    const ap = exactPin(a),
      bp = exactPin(b);
    if (!a || !b)
      add(
        'Задания',
        path,
        'Практика или материал',
        a
          ? ap
            ? referenceValue(ap)
            : value(label(a.frozen['title'], 'Закреплённое задание'))
          : { state: 'missing' },
        b
          ? bp
            ? referenceValue(bp)
            : value(label(b.frozen['title'], 'Закреплённое задание'))
          : { state: 'missing' },
        a ? 'removed' : 'added',
      );
    if (a && b && stable(a.reference) !== stable(b.reference))
      add(
        'Задания',
        path,
        ap && bp && ap.activityId !== bp.activityId ? 'Источник задания' : 'Закреплённая версия',
        referenceValue(ap),
        referenceValue(bp),
        'changed',
        true,
      );
    const oldFrozen = a?.frozen ?? {},
      newFrozen = b?.frozen ?? {};
    fields('Задания', path, oldFrozen, newFrozen, {
      title: 'Название задания',
      brief: 'Инструкция в уроке',
      goal: 'Цель',
      moduleKey: 'Лаборатория',
      ageBand: 'Возрастная группа',
      staticSampleImage: 'Адрес образца',
      hasVersionedSample: 'Есть закреплённый образец',
      sampleContentType: 'Формат образца',
    });
    fields('Политика', path, oldFrozen, newFrozen, {
      resultMode: 'Вид результата',
      maxPoints: 'Максимум баллов',
    });
    if (stable(oldFrozen['sampleChecksum']) !== stable(newFrozen['sampleChecksum'])) {
      const oldSample = read(oldFrozen, 'sampleChecksum'),
        newSample = read(newFrozen, 'sampleChecksum');
      add(
        'Задания',
        path,
        'Изображение образца',
        oldSample.state === 'value' ? value(`Образец версии ${left.versionNumber}`) : oldSample,
        newSample.state === 'value' ? value(`Образец версии ${right.versionNumber}`) : newSample,
      );
    }
    if ((!a || ap) && (!b || bp)) {
      fields('Задания', path, object(ap), object(bp), {
        title: 'Название задания',
        instructions: 'Инструкция задания',
        moduleKey: 'Лаборатория',
      });
      for (const [field, name] of [
        ['goal', 'Цель задания'],
        ['blocks', 'Материалы задания'],
      ] as const) {
        const oldValue = snapshotValue(a, ap, field),
          newValue = snapshotValue(b, bp, field);
        const unavailable = oldValue.state === 'unavailable' || newValue.state === 'unavailable';
        // Equal unknowns are still incomplete evidence, including the same old
        // activity pinned in two different published course versions.
        add(
          'Задания',
          path,
          name,
          oldValue,
          newValue,
          unavailable ? 'unavailable' : 'changed',
          unavailable,
        );
      }
      fields('Политика', path, object(ap), object(bp), {
        resultMode: 'Вид результата',
        maxPoints: 'Максимум баллов',
      });
      if ((!a || ap?.policySnapshot) && (!b || bp?.policySnapshot))
        for (const [key, name] of Object.entries(policyNames))
          policies(
            path,
            read(object(ap?.policySnapshot), key),
            read(object(bp?.policySnapshot), key),
            name,
          );
    }
    if ((a && (!ap || !ap.policySnapshot)) || (b && (!bp || !bp.policySnapshot)))
      add(
        'Политика',
        path,
        'Исторические условия недоступны — нельзя точно сравнить',
        !a
          ? { state: 'missing' }
          : ap?.policySnapshot
            ? value('Сохранены в версии задания')
            : { state: 'unavailable' },
        !b
          ? { state: 'missing' }
          : bp?.policySnapshot
            ? value('Сохранены в версии задания')
            : { state: 'unavailable' },
        'unavailable',
        true,
      );
  }
  const seen = new Set<string>();
  return changes.filter((change) => {
    const identity = stable(change);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function courseVersionStructuralDiff(
  left: PublishedAuthorVersion,
  right: PublishedAuthorVersion,
): CourseVersionDiffCategory[] {
  const changed = new Set(courseVersionChanges(left, right).map((change) => change.category));
  return categories.filter((category) => changed.has(category));
}

/** Display values without resolving any current policy or mutable material. */
export function courseVersionValueText(input: CourseVersionValue, field = ''): string {
  if (input.state !== 'value')
    return input.state === 'missing'
      ? 'Не сохранено'
      : input.state === 'null'
        ? 'Не задано'
        : 'Исторические данные недоступны';
  const enumFields = new Set([
    'Тип урока',
    'Лаборатория',
    'Вид результата',
    'Тип блока',
    'Тип примечания',
  ]);
  function format(current: unknown, key = ''): string {
    if (current === null) return 'Не задано';
    if (typeof current === 'boolean') return current ? 'Да' : 'Нет';
    if (typeof current === 'string')
      return (
        (enumFields.has(field) ||
        enumFields.has(key) ||
        field.endsWith(' · Правило') ||
        ['type', 'mode', 'kind', 'status'].includes(key)
          ? lookup(valueNames, current)
          : undefined) ??
        (current || 'Пустой текст')
      );
    if (Array.isArray(current))
      return current.length ? current.map((item) => format(item)).join('\n') : 'Пустой список';
    if (typeof current === 'object')
      return (
        Object.keys(object(current))
          .sort()
          .map((key) => `${lookup(fieldNames, key) ?? key}: ${format(object(current)[key], key)}`)
          .join('; ') || 'Без дополнительных условий'
      );
    return String(current);
  }
  return format(input.value);
}
