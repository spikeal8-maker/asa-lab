import type { ChessEngineAnalysis, ChessEngineCachePort } from '../application/engine-contract.js';

export class MemoryChessEngineCache implements ChessEngineCachePort {
  private readonly partitions = new Map<string, Map<string, ChessEngineAnalysis>>();

  async get(partition: string, key: string): Promise<ChessEngineAnalysis | null> {
    const value = this.partitions.get(partition)?.get(key);
    return value ? structuredClone(value) : null;
  }

  async set(partition: string, key: string, analysis: ChessEngineAnalysis): Promise<void> {
    let values = this.partitions.get(partition);
    if (!values) {
      values = new Map<string, ChessEngineAnalysis>();
      this.partitions.set(partition, values);
    }
    values.set(key, structuredClone(analysis));
  }

  /** Test and local-evidence helper. */
  entryCount(partition: string): number {
    return this.partitions.get(partition)?.size ?? 0;
  }
}
