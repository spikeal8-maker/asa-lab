import type { Color } from '../domain/chess.js';
import type { ChessSessionPolicy } from '../domain/fair-play.js';

export const CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION = 1 as const;

export interface ChessEngineIdentity {
  readonly name: string;
  readonly version: string;
  readonly protocol: 'internal' | 'uci';
  /** Exact distributed engine artifact. Internal adapters may use null. */
  readonly binarySha256: string | null;
  /** Exact evaluation network artifact. Engines without a network use null. */
  readonly networkSha256: string | null;
}

export type ChessEngineSearch =
  | { readonly kind: 'depth'; readonly depth: number }
  | { readonly kind: 'move_time'; readonly moveTimeMs: number };

export interface ChessEngineSettings {
  readonly search: ChessEngineSearch;
  readonly multiPv: number;
  readonly threads: number;
  readonly hashMb: number;
  /** Reproducible mode is intentionally restricted to fixed depth and one thread. */
  readonly mode: 'reproducible' | 'interactive';
}

export interface ChessEngineCapabilities {
  readonly searchKinds: readonly ('depth' | 'move_time')[];
  readonly minDepth: number;
  readonly maxDepth: number;
  readonly minMoveTimeMs: number;
  readonly maxMoveTimeMs: number;
  readonly maxMultiPv: number;
  readonly minThreads: number;
  readonly maxThreads: number;
  readonly minHashMb: number;
  readonly maxHashMb: number;
  readonly supportsReproducible: boolean;
}

export interface ChessEngineQuota {
  readonly maxDepth: number;
  readonly maxMoveTimeMs: number;
  readonly maxMultiPv: number;
  readonly maxThreads: number;
  readonly maxHashMb: number;
  readonly maxTimeoutMs: number;
}

export type ChessEngineScore =
  | {
      readonly kind: 'centipawn';
      readonly valueCp: number;
      readonly perspective: 'white';
    }
  | {
      readonly kind: 'mate';
      readonly winner: Color;
      /** Null is permitted only when an adapter can prove mate but not its distance. */
      readonly distancePly: number | null;
    };

export interface ChessEngineLine {
  /** One-based MultiPV rank. */
  readonly rank: number;
  readonly score: ChessEngineScore;
  /** Legal UCI principal variation starting at the requested FEN. */
  readonly movesUci: readonly string[];
}

export interface ChessEngineRawAnalysis {
  readonly lines: readonly ChessEngineLine[];
  readonly depth: number;
  readonly nodes: number;
  readonly durationMs: number;
}

export interface ChessEngineAdapterInput {
  readonly fen: string;
  readonly settings: ChessEngineSettings;
}

export interface ChessEnginePort {
  readonly identity: ChessEngineIdentity;
  readonly capabilities: ChessEngineCapabilities;
  analyse(input: ChessEngineAdapterInput, signal: AbortSignal): Promise<ChessEngineRawAnalysis>;
}

export interface ChessEngineAnalysis extends ChessEngineRawAnalysis {
  readonly schemaVersion: typeof CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION;
  readonly fen: string;
  readonly engine: ChessEngineIdentity;
  readonly settings: ChessEngineSettings;
  readonly cacheKey: string;
}

export interface ChessEngineCachePort {
  get(partition: string, key: string): Promise<ChessEngineAnalysis | null>;
  set(partition: string, key: string, analysis: ChessEngineAnalysis): Promise<void>;
}

export interface AnalyseChessPositionCommand {
  readonly fen: string;
  readonly policy: ChessSessionPolicy;
  /** Opaque privacy boundary, normally a tenant or local-session identifier. */
  readonly cachePartition: string;
  readonly settings: ChessEngineSettings;
  readonly timeoutMs: number;
}

export type ChessEngineAnalysisErrorCode =
  | 'capability_denied'
  | 'invalid_fen'
  | 'invalid_settings'
  | 'unsupported_settings'
  | 'cancelled'
  | 'timeout'
  | 'cache_failure'
  | 'engine_failure'
  | 'invalid_engine_output';

export type ChessEngineAnalysisResult =
  | {
      readonly ok: true;
      readonly value: ChessEngineAnalysis;
      readonly source: 'engine' | 'cache';
    }
  | {
      readonly ok: false;
      readonly code: ChessEngineAnalysisErrorCode;
      readonly message: string;
    };

/**
 * Collision-free canonical cache material. Storage adapters may hash this string,
 * but must retain the exact material as evidence for the hash they persist.
 */
export function buildChessEngineCacheKey(input: {
  readonly fen: string;
  readonly engine: ChessEngineIdentity;
  readonly settings: ChessEngineSettings;
}): string {
  const search =
    input.settings.search.kind === 'depth'
      ? ['depth', input.settings.search.depth]
      : ['move_time', input.settings.search.moveTimeMs];
  return JSON.stringify([
    'asa-chess-engine-analysis',
    CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION,
    input.fen,
    [
      input.engine.name.trim(),
      input.engine.version.trim(),
      input.engine.protocol,
      input.engine.binarySha256?.toLowerCase() ?? null,
      input.engine.networkSha256?.toLowerCase() ?? null,
    ],
    [
      search,
      input.settings.multiPv,
      input.settings.threads,
      input.settings.hashMb,
      input.settings.mode,
    ],
  ]);
}
