import type {
  ChessEngineAdapterInput,
  ChessEnginePort,
  ChessEngineRawAnalysis,
  ChessEngineScore,
} from '../application/engine-contract.js';
import { chooseChessBotMove } from '../domain/bot.js';
import { parseFen } from '../domain/chess.js';

export const ASA_LITE_FIXED_THREADS = 1 as const;
/** ASA Lite has no configurable transposition table; 1 is its fixed contract value. */
export const ASA_LITE_FIXED_HASH_MB = 1 as const;

// The current internal search reserves scores close to +/-100000 for mate.
// The adapter deliberately does not infer a distance because it exposes only one root move.
const ASA_LITE_MATE_SENTINEL_MIN = 99_000;

function abortError(): Error {
  const error = new Error('ASA Lite analysis was cancelled.');
  error.name = 'AbortError';
  return error;
}

function requireSupportedInput(input: ChessEngineAdapterInput): 1 | 2 | 3 {
  if (
    input.settings.search.kind !== 'depth' ||
    !Number.isInteger(input.settings.search.depth) ||
    input.settings.search.depth < 1 ||
    input.settings.search.depth > 3
  ) {
    throw new Error('ASA Lite supports fixed depth from 1 to 3 only.');
  }
  if (input.settings.multiPv !== 1) throw new Error('ASA Lite supports MultiPV 1 only.');
  if (input.settings.threads !== ASA_LITE_FIXED_THREADS) {
    throw new Error('ASA Lite uses one fixed search thread.');
  }
  if (input.settings.hashMb !== ASA_LITE_FIXED_HASH_MB) {
    throw new Error('ASA Lite has no configurable hash table.');
  }
  return input.settings.search.depth as 1 | 2 | 3;
}

function scoreFromLegacyCentipawns(scoreCp: number): ChessEngineScore {
  if (Math.abs(scoreCp) >= ASA_LITE_MATE_SENTINEL_MIN) {
    return {
      kind: 'mate',
      winner: scoreCp > 0 ? 'white' : 'black',
      distancePly: null,
    };
  }
  return { kind: 'centipawn', valueCp: scoreCp, perspective: 'white' };
}

/**
 * Compatibility adapter for the existing deterministic ASA search.
 *
 * It is intentionally not presented as Stockfish: it has depth 1-3, one root
 * move instead of a full PV, no time search, no MultiPV and no hash controls.
 */
export class AsaLiteEngineAdapter implements ChessEnginePort {
  readonly identity = {
    name: 'ASA Lite',
    version: 'asa-lite-search-v1',
    protocol: 'internal' as const,
    binarySha256: null,
    networkSha256: null,
  };

  readonly capabilities = {
    searchKinds: ['depth'] as const,
    minDepth: 1,
    maxDepth: 3,
    // Required contract fields; move_time is absent from searchKinds and rejected.
    minMoveTimeMs: 1,
    maxMoveTimeMs: 1,
    maxMultiPv: 1,
    minThreads: ASA_LITE_FIXED_THREADS,
    maxThreads: ASA_LITE_FIXED_THREADS,
    minHashMb: ASA_LITE_FIXED_HASH_MB,
    maxHashMb: ASA_LITE_FIXED_HASH_MB,
    supportsReproducible: true,
  };

  async analyse(
    input: ChessEngineAdapterInput,
    signal: AbortSignal,
  ): Promise<ChessEngineRawAnalysis> {
    if (signal.aborted) throw abortError();
    const depth = requireSupportedInput(input);
    const parsed = parseFen(input.fen);
    if (!parsed.ok) throw new Error(parsed.message);

    const choice = chooseChessBotMove(parsed.value, depth);
    if (signal.aborted) throw abortError();
    if (!choice) return { lines: [], depth: 0, nodes: 0, durationMs: 0 };

    return {
      lines: [
        {
          rank: 1,
          score: scoreFromLegacyCentipawns(choice.scoreCp),
          movesUci: [choice.uci],
        },
      ],
      depth: choice.depth,
      nodes: choice.nodes,
      // The legacy search does not expose timing; zero means not measured.
      durationMs: 0,
    };
  }
}
