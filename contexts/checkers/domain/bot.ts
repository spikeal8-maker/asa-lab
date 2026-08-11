import {
  type CheckersDocument,
  type CheckersDocumentResult,
  type CheckersSide,
} from './document.js';
import {
  applyCheckersMove,
  generateLegalCheckersMoves,
  getCheckersGameStatus,
  type CheckersLegalMove,
} from './rules.js';

export const CHECKERS_BOT_IDS = [
  'iskra',
  'sledopyt',
  'taktik',
  'kombinator',
  'strateg',
  'master',
] as const;

export type CheckersBotId = (typeof CHECKERS_BOT_IDS)[number];
export type CheckersBotExplanation =
  | 'only-legal-move'
  | 'forced-capture'
  | 'material-gain'
  | 'promotion'
  | 'promotion-race'
  | 'position-improvement';

export interface CheckersBotDefinition {
  readonly id: CheckersBotId;
  readonly displayName: string;
  readonly rung: number;
  readonly description: string;
  readonly searchDepth: number;
  readonly defaultNodeBudget: number;
}

export interface CheckersBotSearchOptions {
  readonly seed?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxTimeMs?: number;
  readonly shouldCancel?: () => boolean;
}

export interface CheckersBotDecision {
  readonly botId: CheckersBotId;
  readonly move: CheckersLegalMove;
  readonly score: number;
  readonly searchedNodes: number;
  readonly completedDepth: number;
  readonly cancelled: boolean;
  readonly explanations: readonly CheckersBotExplanation[];
}

interface SearchContext {
  nodes: number;
  aborted: boolean;
  readonly maxNodes: number;
  readonly deadline: number;
  readonly shouldCancel: (() => boolean) | undefined;
  readonly seed: number;
}

interface ScoredMove {
  readonly move: CheckersLegalMove;
  readonly score: number;
}

export const CHECKERS_BOTS: readonly CheckersBotDefinition[] = [
  {
    id: 'iskra',
    displayName: 'Искра',
    rung: 1,
    description: 'Играет только допустимые ходы и выбирает их с управляемым разнообразием.',
    searchDepth: 0,
    defaultNodeBudget: 1,
  },
  {
    id: 'sledopyt',
    displayName: 'Следопыт',
    rung: 2,
    description: 'Замечает материальную выгоду, превращение и безопасность края доски.',
    searchDepth: 1,
    defaultNodeBudget: 96,
  },
  {
    id: 'taktik',
    displayName: 'Тактик',
    rung: 3,
    description: 'Проверяет короткие ответы соперника и гонки к превращению.',
    searchDepth: 2,
    defaultNodeBudget: 800,
  },
  {
    id: 'kombinator',
    displayName: 'Комбинатор',
    rung: 4,
    description: 'Ищет серии взятий, размены и короткие ловушки.',
    searchDepth: 3,
    defaultNodeBudget: 4_000,
  },
  {
    id: 'strateg',
    displayName: 'Стратег',
    rung: 5,
    description: 'Сочетает материал, мобильность, центр, темп и структуру.',
    searchDepth: 4,
    defaultNodeBudget: 12_000,
  },
  {
    id: 'master',
    displayName: 'Мастер',
    rung: 6,
    description: 'Использует углубляющийся поиск в строгом бюджете времени и узлов.',
    searchDepth: 5,
    defaultNodeBudget: 30_000,
  },
] as const;

function definition(botId: CheckersBotId): CheckersBotDefinition {
  return CHECKERS_BOTS.find((bot) => bot.id === botId)!;
}

function opposite(side: CheckersSide): CheckersSide {
  return side === 'light' ? 'dark' : 'light';
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function moveKey(move: CheckersLegalMove, seed: number): number {
  return stableHash(`${seed}:${move.pieceId}:${move.notation}`);
}

function orderedMoves(
  moves: readonly CheckersLegalMove[],
  seed: number,
): readonly CheckersLegalMove[] {
  return [...moves].sort((left, right) => {
    const tactical =
      Number(right.isCapture) - Number(left.isCapture) ||
      right.capturedIds.length - left.capturedIds.length ||
      Number(right.kindAfter === 'king') - Number(left.kindAfter === 'king');
    return tactical || moveKey(left, seed) - moveKey(right, seed);
  });
}

function materialAndPosition(document: CheckersDocument, perspective: CheckersSide): number {
  let score = 0;
  for (const piece of document.pieces) {
    const sign = piece.side === perspective ? 1 : -1;
    const file = piece.square.charCodeAt(0) - 97;
    const rank = Number(piece.square[1]) - 1;
    const material = piece.kind === 'king' ? 320 : 100;
    const advancement = piece.kind === 'man' ? (piece.side === 'light' ? rank : 7 - rank) * 4 : 0;
    const centre = 7 - Math.round(Math.abs(file - 3.5) + Math.abs(rank - 3.5));
    const edgeSafety = file === 0 || file === 7 ? 5 : 0;
    score += sign * (material + advancement + centre + edgeSafety);
  }

  const ownMobility = generateLegalCheckersMoves({
    pieces: document.pieces,
    sideToMove: perspective,
  }).length;
  const opponentMobility = generateLegalCheckersMoves({
    pieces: document.pieces,
    sideToMove: opposite(perspective),
  }).length;
  return score + (ownMobility - opponentMobility) * 2;
}

function evaluate(document: CheckersDocument, perspective: CheckersSide): number {
  const status = getCheckersGameStatus(document);
  if (status.state === 'win') return status.winner === perspective ? 100_000 : -100_000;
  if (status.state === 'draw') return 0;
  return materialAndPosition(document, perspective);
}

function shouldStop(context: SearchContext): boolean {
  if (context.aborted) return true;
  if (
    context.nodes >= context.maxNodes ||
    Date.now() >= context.deadline ||
    context.shouldCancel?.()
  ) {
    context.aborted = true;
    return true;
  }
  return false;
}

function search(
  document: CheckersDocument,
  depth: number,
  alphaValue: number,
  betaValue: number,
  perspective: CheckersSide,
  context: SearchContext,
): number {
  if (shouldStop(context)) return evaluate(document, perspective);
  context.nodes += 1;

  const status = getCheckersGameStatus(document);
  if (depth === 0 || status.state !== 'ongoing') return evaluate(document, perspective);

  const maximizing = document.sideToMove === perspective;
  let best = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let alpha = alphaValue;
  let beta = betaValue;

  for (const move of orderedMoves(generateLegalCheckersMoves(document), context.seed + depth)) {
    if (shouldStop(context)) break;
    const applied = applyCheckersMove(document, { pieceId: move.pieceId, path: move.path });
    if (!applied.ok) continue;
    const score = search(applied.value, depth - 1, alpha, beta, perspective, context);

    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }

  return Number.isFinite(best) ? best : evaluate(document, perspective);
}

function rootSearch(
  document: CheckersDocument,
  moves: readonly CheckersLegalMove[],
  depth: number,
  context: SearchContext,
): readonly ScoredMove[] {
  const perspective = document.sideToMove;
  const scored: ScoredMove[] = [];
  for (const move of orderedMoves(moves, context.seed + depth)) {
    if (shouldStop(context)) break;
    const applied = applyCheckersMove(document, { pieceId: move.pieceId, path: move.path });
    if (!applied.ok) continue;
    scored.push({
      move,
      score: search(
        applied.value,
        Math.max(0, depth - 1),
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        perspective,
        context,
      ),
    });
  }
  return scored;
}

function chooseBest(scored: readonly ScoredMove[], seed: number): ScoredMove | null {
  return (
    [...scored].sort(
      (left, right) =>
        right.score - left.score || moveKey(left.move, seed) - moveKey(right.move, seed),
    )[0] ?? null
  );
}

function explanations(
  document: CheckersDocument,
  legalMoves: readonly CheckersLegalMove[],
  selected: CheckersLegalMove,
): readonly CheckersBotExplanation[] {
  const result: CheckersBotExplanation[] = [];
  if (legalMoves.length === 1) result.push('only-legal-move');
  if (selected.isCapture) result.push('forced-capture', 'material-gain');
  if (selected.kindBefore === 'man' && selected.kindAfter === 'king') result.push('promotion');
  if (!selected.isCapture && selected.kindBefore === 'man') {
    const fromRank = Number(selected.path[0]![1]);
    const toRank = Number(selected.path.at(-1)![1]);
    if (
      (document.sideToMove === 'light' && toRank > fromRank) ||
      (document.sideToMove === 'dark' && toRank < fromRank)
    ) {
      result.push('promotion-race');
    }
  }
  if (result.length === 0) result.push('position-improvement');
  return result;
}

export function chooseCheckersBotMove(
  document: CheckersDocument,
  botId: CheckersBotId,
  options: CheckersBotSearchOptions = {},
): CheckersDocumentResult<CheckersBotDecision> {
  const bot = definition(botId);
  const legalMoves = generateLegalCheckersMoves(document);
  if (document.result !== '*' || legalMoves.length === 0) {
    return { ok: false, message: 'the bot has no legal move in this position' };
  }

  const seed = options.seed ?? 0;
  if (bot.searchDepth === 0) {
    const move = orderedMoves(legalMoves, seed)[seed % legalMoves.length]!;
    return {
      ok: true,
      value: {
        botId,
        move,
        score: 0,
        searchedNodes: 0,
        completedDepth: 0,
        cancelled: false,
        explanations: explanations(document, legalMoves, move),
      },
    };
  }

  const context: SearchContext = {
    nodes: 0,
    aborted: false,
    maxNodes: Math.max(1, options.maxNodes ?? bot.defaultNodeBudget),
    deadline: Date.now() + Math.max(1, options.maxTimeMs ?? 1_000),
    shouldCancel: options.shouldCancel,
    seed,
  };
  const targetDepth = Math.max(1, options.maxDepth ?? bot.searchDepth);
  let completedDepth = 0;
  let selected: ScoredMove = { move: orderedMoves(legalMoves, seed)[0]!, score: 0 };

  for (let depth = 1; depth <= targetDepth; depth += 1) {
    const scored = rootSearch(document, legalMoves, depth, context);
    if (context.aborted || scored.length !== legalMoves.length) break;
    const best = chooseBest(scored, seed + depth);
    if (best) selected = best;
    completedDepth = depth;
  }

  return {
    ok: true,
    value: {
      botId,
      move: selected.move,
      score: selected.score,
      searchedNodes: context.nodes,
      completedDepth,
      cancelled: context.aborted,
      explanations: explanations(document, legalMoves, selected.move),
    },
  };
}
