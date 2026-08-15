import {
  CHECKERS_CONCEPT_IDS,
  createAuthoredCheckersPositionReference,
  generateLegalCheckersMoves,
  isDarkSquare,
  type CheckersConceptId,
  type CheckersDocument,
  type CheckersPiece,
  type CheckersSquare,
} from '@asa-lab/checkers';
import { useEffect, useMemo, useState } from 'react';
import { newClientId } from '../client-id';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'] as const;
const CONCEPT_LABELS: Readonly<Record<CheckersConceptId, string>> = {
  'board-and-coordinates': 'Доска и координаты',
  'man-movement': 'Ход простой шашки',
  'mandatory-capture': 'Обязательное взятие',
  'backward-capture': 'Взятие назад',
  'multi-capture': 'Серия взятий',
  promotion: 'Превращение в дамку',
  'flying-king': 'Летающая дамка',
  'safe-pieces-and-exchange': 'Безопасность и размен',
  tempo: 'Темп',
  'elementary-combinations': 'Комбинации',
  opposition: 'Оппозиция',
  breakthrough: 'Прорыв',
  'promotion-races': 'Гонка к дамке',
  'king-endgames': 'Дамочные окончания',
  'draw-awareness': 'Ничейные позиции',
  'opening-principles': 'Дебютные принципы',
  'full-game-planning': 'План партии',
  'clocks-and-fair-play': 'Часы и честная игра',
};

function initialPieces(): readonly CheckersPiece[] {
  return [
    { id: 'teacher-light-c3', side: 'light', kind: 'man', square: 'c3' },
    { id: 'teacher-dark-d4', side: 'dark', kind: 'man', square: 'd4' },
    { id: 'teacher-dark-h8', side: 'dark', kind: 'man', square: 'h8' },
  ];
}

function nextPiece(
  square: CheckersSquare,
  current: CheckersPiece | undefined,
): CheckersPiece | null {
  if (!current) return { id: `teacher-light-man-${square}`, side: 'light', kind: 'man', square };
  if (current.side === 'light' && current.kind === 'man')
    return { id: `teacher-dark-man-${square}`, side: 'dark', kind: 'man', square };
  if (current.side === 'dark' && current.kind === 'man')
    return { id: `teacher-light-king-${square}`, side: 'light', kind: 'king', square };
  if (current.side === 'light')
    return { id: `teacher-dark-king-${square}`, side: 'dark', kind: 'king', square };
  return null;
}

function pieceLabel(piece: CheckersPiece | undefined): string {
  if (!piece) return 'пусто';
  return `${piece.side === 'light' ? 'светлая' : 'тёмная'} ${
    piece.kind === 'king' ? 'дамка' : 'шашка'
  }`;
}

export function CheckersPositionComposer({
  title,
  instruction,
  onReferenceChange,
}: {
  readonly title: string;
  readonly instruction: string;
  readonly onReferenceChange: (reference: string) => void;
}): JSX.Element {
  const [id] = useState(() => `teacher-position-${newClientId()}`);
  const [pieces, setPieces] = useState<readonly CheckersPiece[]>(initialPieces);
  const [sideToMove, setSideToMove] = useState<'light' | 'dark'>('light');
  const [conceptId, setConceptId] = useState<CheckersConceptId>('mandatory-capture');
  const [expectedNotation, setExpectedNotation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const document = useMemo<CheckersDocument>(
    () => ({
      schemaVersion: 1,
      ruleset: 'russian-64',
      mode: 'lesson',
      sideToMove,
      pieces,
      moveHistory: [],
      result: '*',
    }),
    [pieces, sideToMove],
  );
  const legalMoves = useMemo(() => generateLegalCheckersMoves(document), [document]);
  const selectedMove =
    legalMoves.find((move) => move.notation === expectedNotation) ?? legalMoves[0] ?? null;

  useEffect(() => {
    if (!selectedMove) {
      setError('В позиции нет допустимого хода. Добавьте шашки или смените очередь хода.');
      onReferenceChange('');
      return;
    }
    const result = createAuthoredCheckersPositionReference({
      id,
      title: title.trim() || 'Позиция педагога',
      instruction: instruction.trim() || 'Найди лучший ход в позиции педагога.',
      initialDocument: document,
      conceptIds: [conceptId],
      expectedLines: [[{ pieceId: selectedMove.pieceId, path: selectedMove.path }]],
      hints: [
        `Тема: ${CONCEPT_LABELS[conceptId]}.`,
        'Сначала проверь, есть ли обязательное взятие.',
        `Ходят ${sideToMove === 'light' ? 'светлые' : 'тёмные'}.`,
        `Начальная клетка правильной шашки — ${selectedMove.path[0]}.`,
        `Проверочный ход: ${selectedMove.notation}.`,
      ],
    });
    if (!result.ok) {
      setError(result.message);
      onReferenceChange('');
      return;
    }
    setError(null);
    onReferenceChange(result.value);
  }, [conceptId, document, id, instruction, onReferenceChange, selectedMove, sideToMove, title]);

  return (
    <section
      className="checkers-position-composer"
      aria-labelledby="checkers-position-composer-title"
    >
      <header>
        <div>
          <strong id="checkers-position-composer-title">Конструктор позиции</strong>
          <span>Нажатие на тёмную клетку меняет фигуру: светлая → тёмная → дамки → пусто.</span>
        </div>
        <button type="button" onClick={() => setPieces(initialPieces())}>
          Вернуть пример
        </button>
        <button type="button" onClick={() => setPieces([])}>
          Очистить
        </button>
      </header>
      <div className="checkers-position-composer-layout">
        <div className="checkers-position-board" role="grid" aria-label="Редактор шашечной позиции">
          {RANKS.flatMap((rank) =>
            FILES.map((file) => {
              const square = `${file}${rank}` as CheckersSquare;
              const playable = isDarkSquare(square);
              const piece = pieces.find((candidate) => candidate.square === square);
              return (
                <button
                  key={square}
                  type="button"
                  role="gridcell"
                  className={playable ? 'dark' : 'light'}
                  disabled={!playable}
                  aria-label={`${square}: ${pieceLabel(piece)}`}
                  onClick={() => {
                    const next = nextPiece(square, piece);
                    setPieces((current) => [
                      ...current.filter((candidate) => candidate.square !== square),
                      ...(next ? [next] : []),
                    ]);
                  }}
                >
                  {piece ? (
                    <span
                      className={`checkers-piece ${piece.side} ${piece.kind}`}
                      aria-hidden="true"
                    >
                      {piece.kind === 'king' ? <span className="checkers-crown">◆</span> : null}
                    </span>
                  ) : null}
                </button>
              );
            }),
          )}
        </div>
        <div className="checkers-position-fields">
          <label>
            Кто ходит
            <select
              value={sideToMove}
              onChange={(event) => setSideToMove(event.target.value as 'light' | 'dark')}
            >
              <option value="light">Светлые</option>
              <option value="dark">Тёмные</option>
            </select>
          </label>
          <label>
            Проверяемый навык
            <select
              value={conceptId}
              onChange={(event) => setConceptId(event.target.value as CheckersConceptId)}
            >
              {CHECKERS_CONCEPT_IDS.map((item) => (
                <option key={item} value={item}>
                  {CONCEPT_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Правильный ход
            <select
              value={selectedMove?.notation ?? ''}
              onChange={(event) => setExpectedNotation(event.target.value)}
              disabled={legalMoves.length === 0}
            >
              {legalMoves.map((move) => (
                <option key={`${move.pieceId}-${move.notation}`} value={move.notation}>
                  {move.notation}
                </option>
              ))}
            </select>
          </label>
          <p className={error ? 'error' : 'ready'}>
            {error ??
              `Позиция готова: ${pieces.length} фигур, проверочный ход ${selectedMove?.notation}.`}
          </p>
        </div>
      </div>
    </section>
  );
}
