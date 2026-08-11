import { describe, expect, it } from 'vitest';
import { analyseChessPosition } from '../application/analyse-position';
import type { ChessEngineSettings } from '../application/engine-contract';
import { findLegalMoveByUci, parseFen } from '../domain/chess';
import {
  ASA_LITE_FIXED_HASH_MB,
  ASA_LITE_FIXED_THREADS,
  AsaLiteEngineAdapter,
} from '../infrastructure/asa-lite-engine-adapter';
import { MemoryChessEngineCache } from '../infrastructure/memory-engine-cache';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const CHECKMATE_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
const MATE_IN_ONE_FEN = '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1';

function settings(depth: 1 | 2 | 3 = 2): ChessEngineSettings {
  return {
    search: { kind: 'depth', depth },
    multiPv: 1,
    threads: ASA_LITE_FIXED_THREADS,
    hashMb: ASA_LITE_FIXED_HASH_MB,
    mode: 'reproducible',
  };
}

describe('ASA Lite engine adapter', () => {
  it('publishes only its honest fixed capabilities and internal identity', () => {
    const adapter = new AsaLiteEngineAdapter();
    expect(adapter.identity).toEqual({
      name: 'ASA Lite',
      version: 'asa-lite-search-v1',
      protocol: 'internal',
      binarySha256: null,
      networkSha256: null,
    });
    expect(adapter.capabilities).toMatchObject({
      searchKinds: ['depth'],
      minDepth: 1,
      maxDepth: 3,
      maxMultiPv: 1,
      minThreads: 1,
      maxThreads: 1,
      minHashMb: 1,
      maxHashMb: 1,
      supportsReproducible: true,
    });
  });

  it.each([1, 2, 3] as const)(
    'returns the same single legal root move twice at depth %s',
    async (depth) => {
      const adapter = new AsaLiteEngineAdapter();
      const controller = new AbortController();
      const input = { fen: START_FEN, settings: settings(depth) };
      const first = await adapter.analyse(input, controller.signal);
      const second = await adapter.analyse(input, controller.signal);
      expect(second).toEqual(first);
      expect(first).toMatchObject({ depth, durationMs: 0 });
      expect(first.lines).toHaveLength(1);
      expect(first.lines[0]?.movesUci).toHaveLength(1);
      const parsed = parseFen(START_FEN);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(findLegalMoveByUci(parsed.value, first.lines[0]!.movesUci[0]!)).not.toBeNull();
    },
  );

  it('returns zero lines and zero search statistics when no legal move exists', async () => {
    const result = await new AsaLiteEngineAdapter().analyse(
      { fen: CHECKMATE_FEN, settings: settings(3) },
      new AbortController().signal,
    );
    expect(result).toEqual({ lines: [], depth: 0, nodes: 0, durationMs: 0 });
  });

  it('maps the legacy mate sentinel without inventing mate distance', async () => {
    const result = await new AsaLiteEngineAdapter().analyse(
      { fen: MATE_IN_ONE_FEN, settings: settings(2) },
      new AbortController().signal,
    );
    expect(result.lines[0]?.score).toEqual({
      kind: 'mate',
      winner: 'white',
      distancePly: null,
    });
  });

  it.each([
    {
      label: 'move time',
      settings: {
        ...settings(),
        search: { kind: 'move_time' as const, moveTimeMs: 100 },
        mode: 'interactive' as const,
      },
    },
    { label: 'MultiPV', settings: { ...settings(), multiPv: 2 } },
    { label: 'threads', settings: { ...settings(), threads: 2 } },
    { label: 'hash', settings: { ...settings(), hashMb: 2 } },
  ])('is rejected by orchestration for unsupported $label settings', async ({ settings }) => {
    const result = await analyseChessPosition({
      engine: new AsaLiteEngineAdapter(),
      cache: new MemoryChessEngineCache(),
      quota: {
        maxDepth: 10,
        maxMoveTimeMs: 1_000,
        maxMultiPv: 4,
        maxThreads: 4,
        maxHashMb: 64,
        maxTimeoutMs: 1_000,
      },
      command: {
        fen: START_FEN,
        policy: 'analysis_project',
        cachePartition: 'tenant-a',
        settings,
        timeoutMs: 500,
      },
    });
    expect(result).toMatchObject({ ok: false, code: 'unsupported_settings' });
  });

  it('rejects an already-cancelled direct request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new AsaLiteEngineAdapter().analyse(
        { fen: START_FEN, settings: settings() },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
