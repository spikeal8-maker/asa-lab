import type { ChessPuzzle } from '@asa-lab/chess';

/**
 * Small original foundation set used to prove the trainer lifecycle. It is not
 * copied from Chess.com and is not presented as a production puzzle corpus.
 */
export const ASA_STARTER_PUZZLES: readonly ChessPuzzle[] = [
  {
    schemaVersion: 1,
    id: 'asa-mate-one-001',
    title: 'Мат в один ход',
    initialFen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
    solutionUci: ['f7g7'],
    themes: ['mate'],
    rating: 500,
    explanation:
      'Ферзь встаёт на g7 под защиту короля. Чёрный король не может взять ферзя и не имеет свободных полей.',
  },
  {
    schemaVersion: 1,
    id: 'asa-back-rank-001',
    title: 'Мат по последней горизонтали',
    initialFen: '6k1/5ppp/8/8/8/8/6PP/3R2K1 w - - 0 1',
    solutionUci: ['d1d8'],
    themes: ['mate'],
    rating: 650,
    explanation:
      'Ладья входит на восьмую горизонталь. Собственные пешки лишают чёрного короля полей отхода.',
  },
  {
    schemaVersion: 1,
    id: 'asa-development-001',
    title: 'Центр и развитие',
    initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    solutionUci: ['e2e4', 'e7e5', 'g1f3'],
    themes: ['calculation'],
    rating: 400,
    explanation:
      'Белые занимают центр пешкой e, после симметричного ответа развивают королевского коня к центру.',
  },
];
