import type { ChessDocument } from './document.js';

export interface ChessOpeningLine {
  readonly id: string;
  readonly eco: string;
  readonly name: string;
  readonly sanMoves: readonly string[];
  readonly ideas: readonly string[];
  readonly warnings: readonly string[];
}

export interface ChessOpeningSuggestion {
  readonly san: string;
  readonly resultingOpeningId: string;
  readonly resultingOpeningName: string;
  readonly explanation: string;
}

export interface ChessOpeningExplorerResult {
  readonly matched: ChessOpeningLine | null;
  readonly matchedPly: number;
  readonly exact: boolean;
  readonly suggestions: readonly ChessOpeningSuggestion[];
  readonly source: 'asa-curated-v1';
  readonly note: string;
}

/**
 * Small original educational book. It contains names and general chess ideas,
 * not copied game-database statistics or proprietary opening text.
 */
export const ASA_OPENING_BOOK: readonly ChessOpeningLine[] = [
  {
    id: 'open-game',
    eco: 'C20',
    name: 'Открытая игра',
    sanMoves: ['e4', 'e5'],
    ideas: ['быстрое развитие', 'контроль центра', 'ранняя рокировка'],
    warnings: ['не выводите ферзя слишком рано'],
  },
  {
    id: 'italian-game',
    eco: 'C50',
    name: 'Итальянская партия',
    sanMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    ideas: ['давление на f7', 'развитие слона', 'подготовка рокировки'],
    warnings: ['учитывайте контрудар ...Nf6'],
  },
  {
    id: 'ruy-lopez',
    eco: 'C60',
    name: 'Испанская партия',
    sanMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
    ideas: ['давление на коня c6', 'поддержка пешки e4', 'долговременная борьба за центр'],
    warnings: ['взятие на c6 не выигрывает пешку автоматически'],
  },
  {
    id: 'sicilian-defence',
    eco: 'B20',
    name: 'Сицилианская защита',
    sanMoves: ['e4', 'c5'],
    ideas: ['асимметричная борьба', 'контроль d4', 'контригра на ферзевом фланге'],
    warnings: ['чёрным нужно завершить развитие до активных операций'],
  },
  {
    id: 'french-defence',
    eco: 'C00',
    name: 'Французская защита',
    sanMoves: ['e4', 'e6', 'd4', 'd5'],
    ideas: ['удар по центру ...c5', 'прочная пешечная цепь', 'контригра против d4'],
    warnings: ['слон c8 часто требует специального плана развития'],
  },
  {
    id: 'caro-kann',
    eco: 'B10',
    name: 'Защита Каро — Канн',
    sanMoves: ['e4', 'c6', 'd4', 'd5'],
    ideas: ['надёжный центр', 'вывод слона c8 до ...e6', 'эндшпильная прочность'],
    warnings: ['пассивность возникает без своевременного развития'],
  },
  {
    id: 'queens-gambit',
    eco: 'D06',
    name: 'Ферзевый гамбит',
    sanMoves: ['d4', 'd5', 'c4'],
    ideas: ['давление на центр d5', 'пространство на ферзевом фланге', 'развитие коня c3'],
    warnings: ['пешка c4 является стратегическим предложением, а не мгновенной жертвой'],
  },
  {
    id: 'kings-indian',
    eco: 'E60',
    name: 'Староиндийская защита',
    sanMoves: ['d4', 'Nf6', 'c4', 'g6'],
    ideas: ['фианкетто слона g7', 'контрудар ...e5 или ...c5', 'борьба против белого центра'],
    warnings: ['чёрным нельзя бесконечно уступать пространство без контригры'],
  },
  {
    id: 'english-opening',
    eco: 'A10',
    name: 'Английское начало',
    sanMoves: ['c4'],
    ideas: ['контроль d5', 'гибкая пешечная структура', 'возможность фианкетто'],
    warnings: ['позиция может перейти в другие дебюты с перестановкой ходов'],
  },
] as const;

function isPrefix(prefix: readonly string[], value: readonly string[]): boolean {
  return prefix.length <= value.length && prefix.every((move, index) => value[index] === move);
}

export function exploreChessOpening(
  sanMoves: readonly string[] | ChessDocument,
): ChessOpeningExplorerResult {
  const moves = Array.isArray(sanMoves)
    ? sanMoves
    : sanMoves.moves.map((move) => move.san);
  const matched = [...ASA_OPENING_BOOK]
    .filter((opening) => isPrefix(opening.sanMoves, moves) || isPrefix(moves, opening.sanMoves))
    .sort((left, right) => right.sanMoves.length - left.sanMoves.length)[0] ?? null;
  const suggestions = ASA_OPENING_BOOK
    .filter(
      (opening) =>
        opening.sanMoves.length > moves.length &&
        isPrefix(moves, opening.sanMoves),
    )
    .map((opening) => ({
      san: opening.sanMoves[moves.length]!,
      resultingOpeningId: opening.id,
      resultingOpeningName: opening.name,
      explanation: opening.ideas[0] ?? 'Продолжайте развитие и контроль центра.',
    }))
    .filter(
      (suggestion, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.san === suggestion.san &&
            candidate.resultingOpeningId === suggestion.resultingOpeningId,
        ) === index,
    )
    .sort(
      (left, right) =>
        left.san.localeCompare(right.san) ||
        left.resultingOpeningName.localeCompare(right.resultingOpeningName),
    );
  return {
    matched,
    matchedPly: matched ? Math.min(matched.sanMoves.length, moves.length) : 0,
    exact: Boolean(matched && matched.sanMoves.length === moves.length),
    suggestions,
    source: 'asa-curated-v1',
    note:
      'Curated educational opening guidance. No external game-database statistics or proprietary explorer data are used.',
  };
}
