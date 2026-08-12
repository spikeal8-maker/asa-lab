import {
  applyMoveUnchecked,
  findLegalMoveByUci,
  generateLegalMoves,
  parseFen,
  toFen,
  type ChessPosition,
} from '../domain/chess.js';
import { chessCapabilityDecision } from '../domain/fair-play.js';
import {
  CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION,
  buildChessEngineCacheKey,
  type AnalyseChessPositionCommand,
  type ChessEngineAnalysis,
  type ChessEngineAnalysisResult,
  type ChessEngineCachePort,
  type ChessEngineCapabilities,
  type ChessEngineIdentity,
  type ChessEngineLine,
  type ChessEnginePort,
  type ChessEngineQuota,
  type ChessEngineRawAnalysis,
  type ChessEngineSettings,
} from './engine-contract.js';

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_CACHE_PARTITION_LENGTH = 256;

function failure(
  code: Exclude<ChessEngineAnalysisResult, { readonly ok: true }>['code'],
  message: string,
): ChessEngineAnalysisResult {
  return { ok: false, code, message };
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizedIdentity(identity: ChessEngineIdentity): ChessEngineIdentity | null {
  const name = identity.name.trim();
  const version = identity.version.trim();
  if (name.length === 0 || name.length > 128 || version.length === 0 || version.length > 128) {
    return null;
  }
  if (identity.protocol !== 'internal' && identity.protocol !== 'uci') return null;
  const binarySha256 = identity.binarySha256?.toLowerCase() ?? null;
  const networkSha256 = identity.networkSha256?.toLowerCase() ?? null;
  if (binarySha256 !== null && !SHA256.test(binarySha256)) return null;
  if (networkSha256 !== null && !SHA256.test(networkSha256)) return null;
  return { name, version, protocol: identity.protocol, binarySha256, networkSha256 };
}

function validQuota(quota: ChessEngineQuota): boolean {
  return (
    isPositiveInteger(quota.maxDepth) &&
    isPositiveInteger(quota.maxMoveTimeMs) &&
    isPositiveInteger(quota.maxMultiPv) &&
    isPositiveInteger(quota.maxThreads) &&
    isPositiveInteger(quota.maxHashMb) &&
    isPositiveInteger(quota.maxTimeoutMs)
  );
}

function validCapabilities(capabilities: ChessEngineCapabilities): boolean {
  const kinds = new Set(capabilities.searchKinds);
  return (
    kinds.size === capabilities.searchKinds.length &&
    [...kinds].every((kind) => kind === 'depth' || kind === 'move_time') &&
    isPositiveInteger(capabilities.minDepth) &&
    isPositiveInteger(capabilities.maxDepth) &&
    capabilities.minDepth <= capabilities.maxDepth &&
    isPositiveInteger(capabilities.minMoveTimeMs) &&
    isPositiveInteger(capabilities.maxMoveTimeMs) &&
    capabilities.minMoveTimeMs <= capabilities.maxMoveTimeMs &&
    isPositiveInteger(capabilities.maxMultiPv) &&
    isPositiveInteger(capabilities.minThreads) &&
    isPositiveInteger(capabilities.maxThreads) &&
    capabilities.minThreads <= capabilities.maxThreads &&
    isPositiveInteger(capabilities.minHashMb) &&
    isPositiveInteger(capabilities.maxHashMb) &&
    capabilities.minHashMb <= capabilities.maxHashMb
  );
}

function settingsProblem(
  settings: ChessEngineSettings,
  quota: ChessEngineQuota,
  capabilities: ChessEngineCapabilities,
): { readonly code: 'invalid_settings' | 'unsupported_settings'; readonly message: string } | null {
  if (
    !isPositiveInteger(settings.multiPv) ||
    !isPositiveInteger(settings.threads) ||
    !isPositiveInteger(settings.hashMb) ||
    (settings.mode !== 'reproducible' && settings.mode !== 'interactive')
  ) {
    return { code: 'invalid_settings', message: 'Engine settings must be positive integers.' };
  }
  if (
    settings.multiPv > quota.maxMultiPv ||
    settings.threads > quota.maxThreads ||
    settings.hashMb > quota.maxHashMb
  ) {
    return { code: 'invalid_settings', message: 'Engine settings exceed the analysis quota.' };
  }
  if (
    settings.multiPv > capabilities.maxMultiPv ||
    settings.threads < capabilities.minThreads ||
    settings.threads > capabilities.maxThreads ||
    settings.hashMb < capabilities.minHashMb ||
    settings.hashMb > capabilities.maxHashMb
  ) {
    return {
      code: 'unsupported_settings',
      message: 'Engine adapter does not support the settings.',
    };
  }
  if (settings.search.kind === 'depth') {
    if (!isPositiveInteger(settings.search.depth) || settings.search.depth > quota.maxDepth) {
      return { code: 'invalid_settings', message: 'Depth is invalid or exceeds the quota.' };
    }
    if (
      !capabilities.searchKinds.includes('depth') ||
      settings.search.depth < capabilities.minDepth ||
      settings.search.depth > capabilities.maxDepth
    ) {
      return {
        code: 'unsupported_settings',
        message: 'Engine adapter does not support the depth.',
      };
    }
  } else if (settings.search.kind === 'move_time') {
    if (
      !isPositiveInteger(settings.search.moveTimeMs) ||
      settings.search.moveTimeMs > quota.maxMoveTimeMs
    ) {
      return { code: 'invalid_settings', message: 'Move time is invalid or exceeds the quota.' };
    }
    if (
      !capabilities.searchKinds.includes('move_time') ||
      settings.search.moveTimeMs < capabilities.minMoveTimeMs ||
      settings.search.moveTimeMs > capabilities.maxMoveTimeMs
    ) {
      return {
        code: 'unsupported_settings',
        message: 'Engine adapter does not support the move time.',
      };
    }
  } else {
    return { code: 'invalid_settings', message: 'Unknown engine search kind.' };
  }
  if (
    settings.mode === 'reproducible' &&
    (!capabilities.supportsReproducible ||
      settings.search.kind !== 'depth' ||
      settings.threads !== 1)
  ) {
    return {
      code: 'unsupported_settings',
      message: 'Reproducible analysis requires fixed depth, one thread and adapter support.',
    };
  }
  return null;
}

function scoreProblem(line: ChessEngineLine): string | null {
  if (typeof line.score !== 'object' || line.score === null) return 'Engine score is missing.';
  if (line.score.kind === 'centipawn') {
    return Number.isSafeInteger(line.score.valueCp) && line.score.perspective === 'white'
      ? null
      : 'Centipawn score must be a finite integer from White perspective.';
  }
  if (line.score.kind !== 'mate') return 'Unknown engine score kind.';
  if (line.score.winner !== 'white' && line.score.winner !== 'black') {
    return 'Mate score must identify a winner.';
  }
  return line.score.distancePly === null || isPositiveInteger(line.score.distancePly)
    ? null
    : 'Mate distance must be null or a positive ply count.';
}

function outputProblem(
  output: ChessEngineRawAnalysis,
  position: ChessPosition,
  settings: ChessEngineSettings,
): string | null {
  if (
    typeof output !== 'object' ||
    output === null ||
    !Array.isArray(output.lines) ||
    !isNonNegativeInteger(output.depth) ||
    !isNonNegativeInteger(output.nodes) ||
    !Number.isFinite(output.durationMs) ||
    output.durationMs < 0
  ) {
    return 'Engine statistics must be finite and non-negative.';
  }
  const rootMoves = generateLegalMoves(position);
  if (rootMoves.length === 0) {
    return output.lines.length === 0 ? null : 'A terminal position cannot contain engine lines.';
  }
  if (output.depth === 0) return 'A non-terminal analysis must report positive depth.';
  if (
    output.lines.length === 0 ||
    output.lines.length > Math.min(settings.multiPv, rootMoves.length)
  ) {
    return 'Engine line count does not match the requested MultiPV bound.';
  }
  const roots = new Set<string>();
  for (const [index, line] of output.lines.entries()) {
    if (typeof line !== 'object' || line === null) return 'Engine line has an invalid shape.';
    if (line.rank !== index + 1) return 'MultiPV ranks must be contiguous and one-based.';
    const score = scoreProblem(line);
    if (score) return score;
    if (!Array.isArray(line.movesUci) || line.movesUci.length === 0) {
      return 'Every non-terminal engine line must contain a principal variation.';
    }
    const root = line.movesUci[0]!;
    if (roots.has(root)) return 'MultiPV lines must have distinct root moves.';
    roots.add(root);
    let cursor = position;
    for (const uci of line.movesUci) {
      const move = findLegalMoveByUci(cursor, uci);
      if (!move) return `Engine line contains illegal move ${uci}.`;
      cursor = applyMoveUnchecked(cursor, move);
    }
  }
  return null;
}

function cachedAnalysisProblem(
  analysis: ChessEngineAnalysis,
  expected: {
    readonly fen: string;
    readonly engine: ChessEngineIdentity;
    readonly settings: ChessEngineSettings;
    readonly cacheKey: string;
    readonly position: ChessPosition;
  },
): string | null {
  if (typeof analysis !== 'object' || analysis === null) {
    return 'Cached analysis has an invalid shape.';
  }
  let analysisKey: string;
  try {
    analysisKey = buildChessEngineCacheKey({
      fen: analysis.fen,
      engine: analysis.engine,
      settings: analysis.settings,
    });
  } catch {
    return 'Cached analysis has an invalid shape.';
  }
  if (
    analysis.schemaVersion !== CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION ||
    analysis.fen !== expected.fen ||
    analysis.cacheKey !== expected.cacheKey ||
    analysisKey !== expected.cacheKey
  ) {
    return 'Cached analysis metadata does not match the request.';
  }
  return outputProblem(analysis, expected.position, expected.settings);
}

class AnalysisAbort extends Error {}

async function runAdapter(
  engine: ChessEnginePort,
  fen: string,
  settings: ChessEngineSettings,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<
  | { readonly ok: true; readonly output: ChessEngineRawAnalysis }
  | {
      readonly ok: false;
      readonly code: 'cancelled' | 'timeout' | 'engine_failure';
      readonly message: string;
    }
> {
  if (externalSignal?.aborted) {
    return { ok: false, code: 'cancelled', message: 'Engine analysis was cancelled.' };
  }
  const controller = new AbortController();
  let timedOut = false;
  const forwardExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener('abort', forwardExternalAbort, { once: true });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new AnalysisAbort()), { once: true });
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const output = await Promise.race([
      engine.analyse({ fen, settings }, controller.signal),
      abortPromise,
    ]);
    return { ok: true, output };
  } catch (error) {
    if (timedOut) return { ok: false, code: 'timeout', message: 'Engine analysis timed out.' };
    if (externalSignal?.aborted || error instanceof AnalysisAbort) {
      return { ok: false, code: 'cancelled', message: 'Engine analysis was cancelled.' };
    }
    return {
      ok: false,
      code: 'engine_failure',
      message: error instanceof Error ? error.message : 'Engine analysis failed.',
    };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardExternalAbort);
  }
}

export async function analyseChessPosition(input: {
  readonly engine: ChessEnginePort;
  readonly cache: ChessEngineCachePort;
  readonly quota: ChessEngineQuota;
  readonly command: AnalyseChessPositionCommand;
  readonly signal?: AbortSignal;
}): Promise<ChessEngineAnalysisResult> {
  const decision = chessCapabilityDecision(input.command.policy, 'engine_analysis');
  if (!decision.allowed) return failure('capability_denied', decision.reason);

  if (input.signal?.aborted) return failure('cancelled', 'Engine analysis was cancelled.');
  const parsed = parseFen(input.command.fen);
  if (!parsed.ok) return failure('invalid_fen', parsed.message);
  const fen = toFen(parsed.value);

  if (
    input.command.cachePartition.length === 0 ||
    input.command.cachePartition.length > MAX_CACHE_PARTITION_LENGTH
  ) {
    return failure('invalid_settings', 'cachePartition must contain 1 to 256 characters.');
  }
  if (!validQuota(input.quota)) return failure('invalid_settings', 'Engine quota is invalid.');
  if (
    !isPositiveInteger(input.command.timeoutMs) ||
    input.command.timeoutMs > input.quota.maxTimeoutMs
  ) {
    return failure('invalid_settings', 'Analysis timeout is invalid or exceeds the quota.');
  }
  const engine = normalizedIdentity(input.engine.identity);
  if (!engine || !validCapabilities(input.engine.capabilities)) {
    return failure('engine_failure', 'Engine adapter metadata is invalid.');
  }
  const problem = settingsProblem(input.command.settings, input.quota, input.engine.capabilities);
  if (problem) return failure(problem.code, problem.message);

  const cacheKey = buildChessEngineCacheKey({ fen, engine, settings: input.command.settings });
  let cached: ChessEngineAnalysis | null;
  try {
    cached = await input.cache.get(input.command.cachePartition, cacheKey);
  } catch (error) {
    return failure(
      'cache_failure',
      error instanceof Error ? error.message : 'Engine cache read failed.',
    );
  }
  if (input.signal?.aborted) return failure('cancelled', 'Engine analysis was cancelled.');
  if (cached) {
    const cachedProblem = cachedAnalysisProblem(cached, {
      fen,
      engine,
      settings: input.command.settings,
      cacheKey,
      position: parsed.value,
    });
    return cachedProblem
      ? failure('invalid_engine_output', cachedProblem)
      : { ok: true, value: cached, source: 'cache' };
  }

  const executed = await runAdapter(
    input.engine,
    fen,
    input.command.settings,
    input.command.timeoutMs,
    input.signal,
  );
  if (!executed.ok) return failure(executed.code, executed.message);
  const outputIssue = outputProblem(executed.output, parsed.value, input.command.settings);
  if (outputIssue) return failure('invalid_engine_output', outputIssue);

  const analysis: ChessEngineAnalysis = {
    schemaVersion: CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION,
    fen,
    engine,
    settings: input.command.settings,
    cacheKey,
    ...executed.output,
  };
  try {
    await input.cache.set(input.command.cachePartition, cacheKey, analysis);
  } catch (error) {
    return failure(
      'cache_failure',
      error instanceof Error ? error.message : 'Engine cache write failed.',
    );
  }
  return { ok: true, value: analysis, source: 'engine' };
}
