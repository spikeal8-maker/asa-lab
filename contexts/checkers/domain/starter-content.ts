import type { CheckersDocument } from './document.js';
import type { CheckersPuzzle } from './puzzle.js';

function lessonPosition(
  pieces: CheckersDocument['pieces'],
  sideToMove: CheckersDocument['sideToMove'] = 'light',
): CheckersDocument {
  return {
    schemaVersion: 1,
    ruleset: 'russian-64',
    mode: 'lesson',
    sideToMove,
    pieces,
    moveHistory: [],
    result: '*',
  };
}

/** Original ASA Lab starter positions. Expected lines are validated by the same
 * Russian-64 rules engine that powers normal games. */
export const CHECKERS_STARTER_PUZZLES: readonly CheckersPuzzle[] = [
  {
    id: 'capture-choice',
    title: 'Обязательное взятие',
    instruction: 'Найди взятие, которое продвигает шашку к превращению.',
    initialDocument: lessonPosition([
      { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
      { id: 'light-h2', side: 'light', kind: 'man', square: 'h2' },
      { id: 'dark-d4', side: 'dark', kind: 'man', square: 'd4' },
      { id: 'dark-g3', side: 'dark', kind: 'man', square: 'g3' },
      { id: 'dark-a7', side: 'dark', kind: 'man', square: 'a7' },
    ]),
    conceptIds: ['mandatory-capture', 'promotion-races'],
    expectedLines: [[{ pieceId: 'light-c3', path: ['c3', 'e5'] }]],
    hints: [
      'Если взятие возможно, тихий ход запрещён.',
      'Проверь шашки на c3 и h2.',
      'Сравни конечную горизонталь двух взятий.',
      'Начни шашкой c3.',
      'Сыграй c3:e5.',
    ],
  },
  {
    id: 'backward-capture',
    title: 'Взятие назад',
    instruction: 'Простая шашка ходит вперёд, но брать может в обе стороны.',
    initialDocument: lessonPosition([
      { id: 'light-c5', side: 'light', kind: 'man', square: 'c5' },
      { id: 'dark-b4', side: 'dark', kind: 'man', square: 'b4' },
      { id: 'dark-h8', side: 'dark', kind: 'man', square: 'h8' },
    ]),
    conceptIds: ['backward-capture', 'mandatory-capture'],
    expectedLines: [[{ pieceId: 'light-c5', path: ['c5', 'a3'] }]],
    hints: [
      'Ищи обязательное взятие.',
      'Соперник стоит ниже светлой шашки.',
      'При взятии простая шашка может двигаться назад.',
      'Проверь диагональ c5-b4-a3.',
      'Сыграй c5:a3.',
    ],
  },
  {
    id: 'capture-series',
    title: 'Серия взятий',
    instruction: 'Заверши весь обязательный маршрут одной шашкой.',
    initialDocument: lessonPosition([
      { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
      { id: 'dark-d4', side: 'dark', kind: 'man', square: 'd4' },
      { id: 'dark-f6', side: 'dark', kind: 'man', square: 'f6' },
      { id: 'dark-a7', side: 'dark', kind: 'man', square: 'a7' },
    ]),
    conceptIds: ['multi-capture', 'mandatory-capture'],
    expectedLines: [[{ pieceId: 'light-c3', path: ['c3', 'e5', 'g7'] }]],
    hints: [
      'После первого взятия проверь продолжение.',
      'Маршрут начинается на c3.',
      'Первая остановка — e5.',
      'На f6 стоит вторая шашка соперника.',
      'Сыграй c3:e5:g7.',
    ],
  },
  {
    id: 'flying-king',
    title: 'Летающая дамка',
    instruction: 'Дамка может приземлиться на любое свободное поле за взятой шашкой.',
    initialDocument: lessonPosition([
      { id: 'light-b2', side: 'light', kind: 'king', square: 'b2' },
      { id: 'dark-d4', side: 'dark', kind: 'man', square: 'd4' },
      { id: 'dark-a7', side: 'dark', kind: 'man', square: 'a7' },
    ]),
    conceptIds: ['flying-king'],
    expectedLines: [[{ pieceId: 'light-b2', path: ['b2', 'e5'] }]],
    hints: [
      'Дамка движется по диагонали на любое расстояние.',
      'Найди тёмную шашку на d4.',
      'Приземлиться нужно за ней.',
      'Для этой задачи выбери ближайшее поле e5.',
      'Сыграй b2:e5.',
    ],
  },
] as const;
