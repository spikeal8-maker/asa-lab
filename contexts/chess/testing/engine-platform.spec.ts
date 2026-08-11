import { describe, expect, it } from 'vitest';
import { analyseChessPosition } from '../application/analyse-position';
import {
  CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION,
  buildChessEngineCacheKey,
  type AnalyseChessPositionCommand,
  type ChessEngineAnalysis,
  type ChessEngineCachePort,
  type ChessEnginePort,
  type ChessEngineRawAnalysis,
  type ChessEngineSettings,
} from '../application/engine-contract';
import { MemoryChessEngineCache } from '../infrastructure/memory-engine-cache';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const TERMINAL_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const SETTINGS: ChessEngineSettings = {
  search: { kind: 'depth', depth: 8 },
  multiPv: 1,
  threads: 1,
  hashMb: 32,
  mode: 'reproducible',
};

const QUOTA = {
  maxDepth: 20,
  maxMoveTimeMs: 5_000,
  maxMultiPv: 3,
  maxThreads: 2,
  maxHashMb: 128,
  maxTimeoutMs: 1_000,
} as const;

function raw(
  lines: ChessEngineRawAnalysis['lines'] = [
    {
      rank: 1,
      score: { kind: 'centipawn', valueCp: 24, perspective: 'white' },
      movesUci: ['e2e4', 'e7e5'],
    },
  ],
): ChessEngineRawAnalysis {
  return { lines, depth: lines.length === 0 ? 0 : 8, nodes: 1_024, durationMs: 4 };
}

class RecordingEngine implements ChessEnginePort {
  readonly identity = {
    name: 'Recording Engine',
    version: '1.0.0',
    protocol: 'uci' as const,
    binarySha256: HASH_A,
    networkSha256: HASH_B,
  };
  readonly capabilities = {
    searchKinds: ['depth', 'move_time'] as const,
    minDepth: 1,
    maxDepth: 24,
    minMoveTimeMs: 1,
    maxMoveTimeMs: 10_000,
    maxMultiPv: 3,
    minThreads: 1,
    maxThreads: 2,
    minHashMb: 16,
    maxHashMb: 128,
    supportsReproducible: true,
  };
  readonly calls: Array<{ readonly fen: string; readonly signal: AbortSignal }> = [];

  constructor(
    private readonly result: (
      input: Parameters<ChessEnginePort['analyse']>[0],
      signal: AbortSignal,
    ) => Promise<ChessEngineRawAnalysis> = async () => raw(),
  ) {}

  async analyse(
    input: Parameters<ChessEnginePort['analyse']>[0],
    signal: AbortSignal,
  ): Promise<ChessEngineRawAnalysis> {
    this.calls.push({ fen: input.fen, signal });
    return this.result(input, signal);
  }
}

class CountingCache implements ChessEngineCachePort {
  gets = 0;
  sets = 0;
  value: ChessEngineAnalysis | null = null;

  async get(): Promise<ChessEngineAnalysis | null> {
    this.gets += 1;
    return this.value;
  }

  async set(_partition: string, _key: string, analysis: ChessEngineAnalysis): Promise<void> {
    this.sets += 1;
    this.value = structuredClone(analysis);
  }
}

function command(
  overrides: Partial<AnalyseChessPositionCommand> = {},
): AnalyseChessPositionCommand {
  return {
    fen: START_FEN,
    policy: 'analysis_project',
    cachePartition: 'tenant-a',
    settings: SETTINGS,
    timeoutMs: 100,
    ...overrides,
  };
}

async function analyse(input: {
  readonly engine?: ChessEnginePort;
  readonly cache?: ChessEngineCachePort;
  readonly command?: AnalyseChessPositionCommand;
  readonly signal?: AbortSignal;
}) {
  return analyseChessPosition({
    engine: input.engine ?? new RecordingEngine(),
    cache: input.cache ?? new MemoryChessEngineCache(),
    quota: QUOTA,
    command: input.command ?? command(),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

describe('CH-102 engine platform foundation', () => {
  it('denies a protected live session before cache or adapter access', async () => {
    const engine = new RecordingEngine();
    const cache = new CountingCache();
    const result = await analyse({
      engine,
      cache,
      command: command({ policy: 'protected_live_rated' }),
    });
    expect(result).toMatchObject({ ok: false, code: 'capability_denied' });
    expect(cache.gets).toBe(0);
    expect(engine.calls).toHaveLength(0);
  });

  it.each(['analysis_project', 'post_game_review'] as const)(
    'allows %s engine analysis',
    async (policy) => {
      const result = await analyse({ command: command({ policy }) });
      expect(result).toMatchObject({ ok: true, source: 'engine' });
    },
  );

  it('canonicalizes FEN and changes the key for engine-affecting input', async () => {
    const engine = new RecordingEngine();
    const cache = new MemoryChessEngineCache();
    const first = await analyse({ engine, cache });
    const second = await analyse({
      engine,
      cache,
      command: command({ fen: `  ${START_FEN.replaceAll(' ', '   ')}  ` }),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.source).toBe('cache');
    expect(first.value.cacheKey).toBe(second.value.cacheKey);
    expect(engine.calls).toHaveLength(1);

    const base = { fen: START_FEN, engine: engine.identity, settings: SETTINGS };
    const baseKey = buildChessEngineCacheKey(base);
    const variants = [
      { ...base, engine: { ...engine.identity, version: '1.0.1' } },
      { ...base, engine: { ...engine.identity, binarySha256: HASH_B } },
      { ...base, engine: { ...engine.identity, networkSha256: HASH_A } },
      { ...base, settings: { ...SETTINGS, search: { kind: 'depth' as const, depth: 9 } } },
      {
        ...base,
        settings: {
          ...SETTINGS,
          search: { kind: 'move_time' as const, moveTimeMs: 250 },
          mode: 'interactive' as const,
        },
      },
      { ...base, settings: { ...SETTINGS, multiPv: 2 } },
      { ...base, settings: { ...SETTINGS, threads: 2, mode: 'interactive' as const } },
      { ...base, settings: { ...SETTINGS, hashMb: 64 } },
    ];
    for (const variant of variants) expect(buildChessEngineCacheKey(variant)).not.toBe(baseKey);
  });

  it.each([
    { settings: { ...SETTINGS, multiPv: 0 }, code: 'invalid_settings' },
    { settings: { ...SETTINGS, multiPv: 4 }, code: 'invalid_settings' },
    {
      settings: { ...SETTINGS, search: { kind: 'depth' as const, depth: 30 } },
      code: 'invalid_settings',
    },
    {
      settings: {
        ...SETTINGS,
        search: { kind: 'move_time' as const, moveTimeMs: 20 },
        mode: 'reproducible' as const,
      },
      code: 'unsupported_settings',
    },
    { settings: { ...SETTINGS, threads: 2 }, code: 'unsupported_settings' },
  ])(
    'rejects invalid or unsupported settings before adapter access',
    async ({ settings, code }) => {
      const engine = new RecordingEngine();
      const result = await analyse({ engine, command: command({ settings }) });
      expect(result).toMatchObject({ ok: false, code });
      expect(engine.calls).toHaveLength(0);
    },
  );

  it('re-authorizes every cache hit', async () => {
    const engine = new RecordingEngine();
    const cache = new CountingCache();
    expect((await analyse({ engine, cache })).ok).toBe(true);
    expect(cache.gets).toBe(1);
    const denied = await analyse({
      engine,
      cache,
      command: command({ policy: 'protected_live_rated' }),
    });
    expect(denied).toMatchObject({ ok: false, code: 'capability_denied' });
    expect(cache.gets).toBe(1);
    expect(engine.calls).toHaveLength(1);
  });

  it('rejects corrupt cached metadata and illegal fresh principal variations', async () => {
    const cache = new CountingCache();
    const engine = new RecordingEngine();
    const valid = await analyse({ cache, engine });
    expect(valid.ok).toBe(true);
    if (!valid.ok || !cache.value) return;
    cache.value = { ...cache.value, schemaVersion: 999 as 1 };
    const corrupt = await analyse({ cache, engine });
    expect(corrupt).toMatchObject({ ok: false, code: 'invalid_engine_output' });

    const illegalEngine = new RecordingEngine(async () =>
      raw([
        {
          rank: 1,
          score: { kind: 'centipawn', valueCp: 1, perspective: 'white' },
          movesUci: ['e2e5'],
        },
      ]),
    );
    const illegal = await analyse({ engine: illegalEngine });
    expect(illegal).toMatchObject({ ok: false, code: 'invalid_engine_output' });
  });

  it('accepts ordered MultiPV lines and rejects duplicate root moves', async () => {
    const settings = { ...SETTINGS, multiPv: 2 };
    const lines: ChessEngineRawAnalysis['lines'] = [
      {
        rank: 1,
        score: { kind: 'centipawn', valueCp: 30, perspective: 'white' },
        movesUci: ['e2e4'],
      },
      {
        rank: 2,
        score: { kind: 'centipawn', valueCp: 20, perspective: 'white' },
        movesUci: ['d2d4'],
      },
    ];
    expect(
      (
        await analyse({
          engine: new RecordingEngine(async () => raw(lines)),
          command: command({ settings }),
        })
      ).ok,
    ).toBe(true);
    const duplicate = await analyse({
      engine: new RecordingEngine(async () =>
        raw([lines[0]!, { ...lines[1]!, movesUci: ['e2e4'] }]),
      ),
      command: command({ settings }),
    });
    expect(duplicate).toMatchObject({ ok: false, code: 'invalid_engine_output' });
  });

  it('preserves mate as a distinct typed score', async () => {
    const result = await analyse({
      engine: new RecordingEngine(async () =>
        raw([
          {
            rank: 1,
            score: { kind: 'mate', winner: 'white', distancePly: 3 },
            movesUci: ['e2e4'],
          },
        ]),
      ),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines[0]?.score).toEqual({
      kind: 'mate',
      winner: 'white',
      distancePly: 3,
    });
  });

  it('does not call the adapter for an already cancelled request', async () => {
    const engine = new RecordingEngine();
    const controller = new AbortController();
    controller.abort();
    const result = await analyse({ engine, signal: controller.signal });
    expect(result).toMatchObject({ ok: false, code: 'cancelled' });
    expect(engine.calls).toHaveLength(0);
  });

  it('aborts the adapter when the bounded timeout expires', async () => {
    let observedSignal: AbortSignal | null = null;
    const engine = new RecordingEngine(
      async (_input, signal) =>
        new Promise<ChessEngineRawAnalysis>(() => {
          observedSignal = signal;
        }),
    );
    const result = await analyse({ engine, command: command({ timeoutMs: 5 }) });
    expect(result).toMatchObject({ ok: false, code: 'timeout' });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('accepts zero lines only for a position without legal moves', async () => {
    const terminal = await analyse({
      engine: new RecordingEngine(async () => raw([])),
      command: command({ fen: TERMINAL_FEN }),
    });
    expect(terminal.ok).toBe(true);
    if (!terminal.ok) return;
    expect(terminal.value).toMatchObject({
      schemaVersion: CHESS_ENGINE_ANALYSIS_SCHEMA_VERSION,
      lines: [],
      depth: 0,
    });

    const nonTerminal = await analyse({ engine: new RecordingEngine(async () => raw([])) });
    expect(nonTerminal).toMatchObject({ ok: false, code: 'invalid_engine_output' });
  });
});
