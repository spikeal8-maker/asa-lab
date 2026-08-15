import { createInitialCheckersDocument, type CheckersDocument } from './document.js';
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
    id: 'first-step',
    title: 'Первый ход и координаты',
    instruction: 'Найди шашку на c3 и сделай спокойный ход по диагонали на b4.',
    initialDocument: lessonPosition([
      { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
      { id: 'dark-h8', side: 'dark', kind: 'man', square: 'h8' },
    ]),
    conceptIds: ['board-and-coordinates', 'man-movement'],
    expectedLines: [[{ pieceId: 'light-c3', path: ['c3', 'b4'] }]],
    hints: [
      'Игровые поля обозначены буквой и цифрой.',
      'Светлые простые шашки идут в сторону восьмой горизонтали.',
      'Тихий ход занимает соседнее свободное поле по диагонали.',
      'Выбери шашку на c3 и посмотри поле слева впереди.',
      'Сыграй c3-b4.',
    ],
  },
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
  {
    id: 'safe-exchange',
    title: 'Безопасность и темп',
    instruction: 'Продвинь центральную шашку, сохранив связь с краем и не открывая взятие.',
    initialDocument: lessonPosition([
      { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
      { id: 'light-g1', side: 'light', kind: 'man', square: 'g1' },
      { id: 'dark-a7', side: 'dark', kind: 'man', square: 'a7' },
      { id: 'dark-h8', side: 'dark', kind: 'man', square: 'h8' },
    ]),
    conceptIds: ['safe-pieces-and-exchange', 'tempo'],
    expectedLines: [[{ pieceId: 'light-c3', path: ['c3', 'd4'] }]],
    hints: [
      'Сначала убедись, что обязательного взятия нет.',
      'Центральные поля дают больше направлений для следующего хода.',
      'Не двигай крайнюю шашку без необходимости.',
      'Продвинь шашку c3 вправо вперед.',
      'Сыграй c3-d4.',
    ],
  },
  {
    id: 'combination-entry',
    title: 'Вход в комбинацию',
    instruction: 'Увидь весь маршрут заранее и сними две шашки одним непрерывным ходом.',
    initialDocument: lessonPosition([
      { id: 'light-e3', side: 'light', kind: 'man', square: 'e3' },
      { id: 'dark-d4', side: 'dark', kind: 'man', square: 'd4' },
      { id: 'dark-b6', side: 'dark', kind: 'man', square: 'b6' },
      { id: 'dark-h8', side: 'dark', kind: 'man', square: 'h8' },
    ]),
    conceptIds: ['elementary-combinations', 'multi-capture'],
    expectedLines: [[{ pieceId: 'light-e3', path: ['e3', 'c5', 'a7'] }]],
    hints: [
      'Взятие обязательно, поэтому ищи маршрут со снятием.',
      'Первая цель стоит на d4.',
      'После приземления на c5 проверь продолжение.',
      'Вторая цель стоит на b6.',
      'Сыграй e3:c5:a7.',
    ],
  },
  {
    id: 'breakthrough-race',
    title: 'Прорыв к превращению',
    instruction: 'Сделай ход, который приближает шашку к дамочному ряду и сохраняет два пути.',
    initialDocument: lessonPosition([
      { id: 'light-c5', side: 'light', kind: 'man', square: 'c5' },
      { id: 'light-g3', side: 'light', kind: 'man', square: 'g3' },
      { id: 'dark-a7', side: 'dark', kind: 'man', square: 'a7' },
      { id: 'dark-h8', side: 'dark', kind: 'man', square: 'h8' },
    ]),
    conceptIds: ['opposition', 'breakthrough', 'promotion-races'],
    expectedLines: [[{ pieceId: 'light-c5', path: ['c5', 'd6'] }]],
    hints: [
      'До превращения светлой шашке осталось две горизонтали.',
      'Сравни поля b6 и d6.',
      'Ход к центру оставляет больше вариантов продолжения.',
      'Выбери шашку c5 и поле справа впереди.',
      'Сыграй c5-d6.',
    ],
  },
  {
    id: 'king-endgame',
    title: 'Дамочное окончание',
    instruction: 'Займи центральную диагональ дамкой и сохрани контроль над длинными линиями.',
    initialDocument: lessonPosition([
      { id: 'light-b2', side: 'light', kind: 'king', square: 'b2' },
      { id: 'dark-h8', side: 'dark', kind: 'king', square: 'h8' },
    ]),
    conceptIds: ['king-endgames', 'draw-awareness'],
    expectedLines: [[{ pieceId: 'light-b2', path: ['b2', 'c3'] }]],
    hints: [
      'Дамка может пройти любое свободное расстояние по диагонали.',
      'В окончаниях важно не прижимать свою дамку к краю без плана.',
      'Центральная диагональ помогает контролировать больше полей.',
      'Сделай короткий точный ход с b2.',
      'Сыграй b2-c3.',
    ],
  },
  {
    id: 'opening-plan',
    title: 'Дебютный план',
    instruction: 'Начни полную партию ходом, который развивает шашку и сохраняет строй.',
    initialDocument: createInitialCheckersDocument('lesson'),
    conceptIds: ['opening-principles', 'full-game-planning'],
    expectedLines: [[{ pieceId: 'light-10', path: ['c3', 'b4'] }]],
    hints: [
      'В начале партии развивай шашки без одиночных рывков.',
      'Сначала проверь, что взятий нет.',
      'Шашка на c3 может начать развитие левого фланга.',
      'Выбери соседнее поле b4.',
      'Сыграй c3-b4.',
    ],
  },
  {
    id: 'fair-play-match',
    title: 'Матч и честная игра',
    instruction:
      'Сделай первый ход учебного матча: спокойно, по правилам и без подсказок сопернику.',
    initialDocument: lessonPosition([
      { id: 'light-a3', side: 'light', kind: 'man', square: 'a3' },
      { id: 'dark-h8', side: 'dark', kind: 'man', square: 'h8' },
    ]),
    conceptIds: ['clocks-and-fair-play'],
    expectedLines: [[{ pieceId: 'light-a3', path: ['a3', 'b4'] }]],
    hints: [
      'До хода проверь очередь и состояние часов.',
      'Используй только разрешённые игровые действия.',
      'После партии поблагодари соперника готовой безопасной реакцией.',
      'У шашки a3 есть одно поле впереди.',
      'Сыграй a3-b4.',
    ],
  },
] as const;

function mirrorSquare(square: string): CheckersDocument['pieces'][number]['square'] {
  const files = 'abcdefgh';
  const file = files[7 - files.indexOf(square[0] ?? '')];
  const rank = 9 - Number(square[1]);
  return `${file}${rank}` as CheckersDocument['pieces'][number]['square'];
}

function oppositeSide(side: CheckersDocument['sideToMove']): CheckersDocument['sideToMove'] {
  return side === 'light' ? 'dark' : 'light';
}

function mirrorPuzzle(puzzle: CheckersPuzzle): CheckersPuzzle {
  const idByPiece = new Map(
    puzzle.initialDocument.pieces.map((piece) => [piece.id, `${piece.id}-transfer`] as const),
  );
  return {
    ...puzzle,
    id: `${puzzle.id}-transfer`,
    title: `${puzzle.title} · новая позиция`,
    instruction: `${puzzle.instruction} Теперь примени то же правило на зеркальной стороне доски.`,
    initialDocument: {
      ...puzzle.initialDocument,
      sideToMove: oppositeSide(puzzle.initialDocument.sideToMove),
      pieces: puzzle.initialDocument.pieces.map((piece) => ({
        ...piece,
        id: idByPiece.get(piece.id)!,
        side: oppositeSide(piece.side),
        square: mirrorSquare(piece.square),
      })),
    },
    expectedLines: puzzle.expectedLines.map((line) =>
      line.map((move) => ({
        pieceId: idByPiece.get(move.pieceId)!,
        path: move.path.map(mirrorSquare),
      })),
    ),
    hints: [
      'Положение изменилось, но проверяемое правило осталось тем же.',
      `Ходят ${puzzle.initialDocument.sideToMove === 'light' ? 'тёмные' : 'светлые'}.`,
      'Сначала самостоятельно проверь все обязательные взятия.',
      `Начни поиск с поля ${mirrorSquare(puzzle.expectedLines[0]![0]!.path[0]!)}.`,
      `Заверши проверочный ход на поле ${mirrorSquare(puzzle.expectedLines[0]![0]!.path.at(-1)!)}.`,
    ],
  };
}

/** Introduction plus a transfer exercise for every curriculum step. */
export const CHECKERS_PRACTICE_PUZZLES: readonly CheckersPuzzle[] =
  CHECKERS_STARTER_PUZZLES.flatMap((puzzle) => [puzzle, mirrorPuzzle(puzzle)]);
