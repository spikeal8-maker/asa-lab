import {
  createInitialCheckersDocument,
  type CheckersDocument,
  type CheckersDocumentResult,
  type CheckersMoveRecord,
  type CheckersSide,
} from './document.js';
import { applyCheckersMove, generateLegalCheckersMoves } from './rules.js';

export type CheckersReviewTheme =
  | 'mandatory-capture'
  | 'tactical-loss'
  | 'forced-exchange'
  | 'turning-point'
  | 'promotion'
  | 'result';

export interface CheckersReviewInsight {
  readonly id: string;
  readonly theme: CheckersReviewTheme;
  readonly ply: number | null;
  readonly tone: 'positive' | 'attention' | 'neutral';
  readonly title: string;
  readonly explanation: string;
}

function sideLabel(side: CheckersSide): string {
  return side === 'light' ? 'светлых' : 'тёмных';
}

function notation(move: CheckersMoveRecord): string {
  return move.path.join(move.capturedIds.length > 0 ? ':' : '-');
}

function immediateCaptureRisk(document: CheckersDocument): number {
  return generateLegalCheckersMoves(document).reduce(
    (largest, move) => Math.max(largest, move.capturedIds.length),
    0,
  );
}

function tacticalAlternative(
  source: CheckersDocument,
  capture: CheckersMoveRecord,
): {
  readonly previous: CheckersMoveRecord;
  readonly alternative: string;
  readonly saved: number;
} | null {
  if (capture.ply < 2) return null;
  const previous = source.moveHistory[capture.ply - 2];
  if (!previous) return null;
  const beforePrevious = replayCheckersGame(source, capture.ply - 2);
  if (!beforePrevious.ok) return null;
  const candidates = generateLegalCheckersMoves(beforePrevious.value);
  let best: { notation: string; risk: number } | null = null;
  for (const candidate of candidates) {
    const applied = applyCheckersMove(beforePrevious.value, candidate);
    if (!applied.ok) continue;
    const risk = immediateCaptureRisk(applied.value);
    if (
      best === null ||
      risk < best.risk ||
      (risk === best.risk && candidate.notation < best.notation)
    ) {
      best = { notation: candidate.notation, risk };
    }
  }
  if (!best || best.risk >= capture.capturedIds.length) return null;
  return { previous, alternative: best.notation, saved: capture.capturedIds.length - best.risk };
}

/**
 * Builds an evidence-based review from the immutable move record. A missed
 * mandatory capture cannot enter the record because every move is accepted by
 * the same rules engine; the review states that explicitly instead of
 * inventing a mistake.
 */
export function analyzeCheckersGameReview(
  document: CheckersDocument,
): readonly CheckersReviewInsight[] {
  const insights: CheckersReviewInsight[] = [
    {
      id: 'mandatory-capture-check',
      theme: 'mandatory-capture',
      ply: null,
      tone: 'positive',
      title: 'Обязательные взятия проверены',
      explanation:
        'Пропущенных обязательных взятий в записи нет: каждый ход принят движком русских шашек.',
    },
  ];
  const captures = document.moveHistory.filter((move) => move.capturedIds.length > 0);
  const largestCapture = captures.reduce<CheckersMoveRecord | null>(
    (largest, move) =>
      largest === null || move.capturedIds.length > largest.capturedIds.length ? move : largest,
    null,
  );

  for (const move of captures) {
    const lostSide: CheckersSide = move.side === 'light' ? 'dark' : 'light';
    const alternative = tacticalAlternative(document, move);
    if (alternative) {
      insights.push({
        id: `tactical-loss-${move.ply}`,
        theme: 'tactical-loss',
        ply: alternative.previous.ply,
        tone: 'attention',
        title: `После хода ${notation(alternative.previous)} возникла потеря`,
        explanation: `Ответ ${notation(move)} снял ${move.capturedIds.length} ${
          move.capturedIds.length === 1 ? 'шашку' : 'шашки'
        } ${sideLabel(lostSide)}. В той позиции ход ${alternative.alternative} уменьшал ближайшую потерю на ${alternative.saved}.`,
      });
    } else {
      insights.push({
        id: `forced-exchange-${move.ply}`,
        theme: 'forced-exchange',
        ply: move.ply,
        tone: 'neutral',
        title: 'Взятие подтверждено правилами',
        explanation: `Ход ${move.ply}: ${notation(move)} снял ${move.capturedIds.length} ${
          move.capturedIds.length === 1 ? 'шашку' : 'шашки'
        }. Разбор не называет это ошибкой без доказанной более безопасной альтернативы.`,
      });
    }
  }

  if (largestCapture) {
    insights.push({
      id: `turning-point-${largestCapture.ply}`,
      theme: 'turning-point',
      ply: largestCapture.ply,
      tone: 'neutral',
      title: 'Переломный момент партии',
      explanation: `Ход ${largestCapture.ply}: ${notation(largestCapture)} — самое крупное взятие (${largestCapture.capturedIds.length}).`,
    });
  }

  for (const move of document.moveHistory.filter((candidate) => candidate.promoted)) {
    insights.push({
      id: `promotion-${move.ply}`,
      theme: 'promotion',
      ply: move.ply,
      tone: 'positive',
      title: 'Превращение в дамку',
      explanation: `Ход ${move.ply}: ${notation(move)}. Оцени, какие новые диагонали открылись после превращения.`,
    });
  }

  if (document.result !== '*') {
    insights.push({
      id: 'game-result',
      theme: 'result',
      ply: document.moveHistory.length,
      tone: 'neutral',
      title: 'Итог партии',
      explanation:
        document.result === '1/2-1/2'
          ? 'Ничья подтверждена правилами окончания партии.'
          : `Победили ${document.result === '1-0' ? 'светлые' : 'тёмные'}. Разбор отмечает проверяемые ходы, а не оценивает ребёнка.`,
    });
  }

  return insights;
}

/** Replays a standard game without mutating its competitive record. */
export function replayCheckersGame(
  source: CheckersDocument,
  throughPly: number,
): CheckersDocumentResult<CheckersDocument> {
  if (source.mode !== 'game') {
    return { ok: false, message: 'only a standard game can be replayed' };
  }
  if (!Number.isInteger(throughPly) || throughPly < 0 || throughPly > source.moveHistory.length) {
    return { ok: false, message: 'replay ply is outside the game record' };
  }
  let replay = createInitialCheckersDocument('game');
  for (const expected of source.moveHistory.slice(0, throughPly)) {
    const applied = applyCheckersMove(replay, { pieceId: expected.pieceId, path: expected.path });
    if (!applied.ok) {
      return { ok: false, message: `move ${expected.ply} cannot be replayed: ${applied.message}` };
    }
    const actual = applied.value.moveHistory.at(-1)!;
    if (
      actual.side !== expected.side ||
      actual.promoted !== expected.promoted ||
      actual.capturedIds.join(',') !== expected.capturedIds.join(',')
    ) {
      return { ok: false, message: `move ${expected.ply} does not match the game record` };
    }
    replay = applied.value;
  }
  return {
    ok: true,
    value: throughPly === source.moveHistory.length ? { ...replay, result: source.result } : replay,
  };
}
