import type { ChessLesson } from './learning-progress.js';
import { validateChessPuzzle, type ChessPuzzle } from './puzzle.js';

const ORIGINAL_PROVENANCE = {
  kind: 'asa_original',
  createdAt: '2026-08-12T00:00:00Z',
  license: 'ASA-Lab-Original',
} as const;

const PUZZLES: readonly ChessPuzzle[] = [
  {
    schemaVersion: 2,
    id: 'asa-mate-one-001',
    contentVersion: '2026-08-12.1',
    title: 'Мат в один ход',
    initialFen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
    solutionLinesUci: [['f7g7']],
    themes: ['mate'],
    rating: 500,
    maxMistakes: 3,
    explanation:
      'Ферзь встаёт на g7 под защиту короля. Чёрный король не может взять ферзя и не имеет свободных полей.',
    provenance: { ...ORIGINAL_PROVENANCE, sourceId: 'asa-lab-editorial-mate-001' },
  },
  {
    schemaVersion: 2,
    id: 'asa-back-rank-001',
    contentVersion: '2026-08-12.1',
    title: 'Мат по последней горизонтали',
    initialFen: '6k1/5ppp/8/8/8/8/6PP/3R2K1 w - - 0 1',
    solutionLinesUci: [['d1d8']],
    themes: ['mate'],
    rating: 650,
    maxMistakes: 3,
    explanation:
      'Ладья входит на восьмую горизонталь. Собственные пешки лишают чёрного короля полей отхода.',
    provenance: { ...ORIGINAL_PROVENANCE, sourceId: 'asa-lab-editorial-mate-002' },
  },
  {
    schemaVersion: 2,
    id: 'asa-development-001',
    contentVersion: '2026-08-12.1',
    title: 'Центр и развитие',
    initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    solutionLinesUci: [
      ['e2e4', 'e7e5', 'g1f3'],
      ['d2d4', 'd7d5', 'g1f3'],
    ],
    themes: ['calculation'],
    rating: 400,
    maxMistakes: 4,
    explanation:
      'Белые занимают центр пешкой, после симметричного ответа развивают королевского коня к центру.',
    provenance: { ...ORIGINAL_PROVENANCE, sourceId: 'asa-lab-editorial-opening-001' },
  },
];

export const ASA_CHESS_PUZZLES: readonly ChessPuzzle[] = PUZZLES.map((puzzle) => {
  const validated = validateChessPuzzle(puzzle);
  if (!validated.ok) throw new Error(`Invalid ASA puzzle ${puzzle.id}: ${validated.message}`);
  return validated.value;
});

export const ASA_CHESS_LESSONS: readonly ChessLesson[] = [
  {
    schemaVersion: 1,
    id: 'asa-lesson-mating-net',
    contentVersion: '2026-08-12.1',
    title: 'Как построить матовую сеть',
    summary: 'Проверьте шах, защиту атакующей фигуры и все поля отхода короля.',
    themes: ['mate'],
    steps: [
      {
        id: 'check',
        title: 'Сначала найдите шах',
        text: 'Рассмотрите все ходы, после которых король соперника немедленно оказывается под атакой.',
        focusSquares: ['g7', 'h8'],
      },
      {
        id: 'protection',
        title: 'Проверьте защиту фигуры',
        text: 'Матующая фигура должна быть защищена или недоступна королю соперника.',
        focusSquares: ['g6', 'g7'],
      },
      {
        id: 'escapes',
        title: 'Закройте поля отхода',
        text: 'Мат доказан только тогда, когда король не может уйти, взять атакующую фигуру или закрыться.',
        focusSquares: ['g8', 'h7', 'g7'],
      },
    ],
    provenance: { ...ORIGINAL_PROVENANCE, sourceId: 'asa-lab-lesson-mate-001' },
  },
  {
    schemaVersion: 1,
    id: 'asa-lesson-opening-development',
    contentVersion: '2026-08-12.1',
    title: 'Центр и лёгкие фигуры',
    summary: 'Займите центр и развивайте фигуры так, чтобы они влияли на ключевые поля.',
    themes: ['calculation'],
    steps: [
      {
        id: 'centre',
        title: 'Займите центр пешкой',
        text: 'Ходы e4 и d4 освобождают линии для фигур и контролируют центральные поля.',
        focusSquares: ['d4', 'e4'],
      },
      {
        id: 'knight',
        title: 'Развивайте коня к центру',
        text: 'На f3 конь атакует центральные поля и помогает подготовить рокировку.',
        focusSquares: ['g1', 'f3'],
      },
    ],
    provenance: { ...ORIGINAL_PROVENANCE, sourceId: 'asa-lab-lesson-opening-001' },
  },
];

export function asaChessPuzzleById(id: string): ChessPuzzle | null {
  return ASA_CHESS_PUZZLES.find((puzzle) => puzzle.id === id) ?? null;
}

export function asaChessLessonById(id: string): ChessLesson | null {
  return ASA_CHESS_LESSONS.find((lesson) => lesson.id === id) ?? null;
}
