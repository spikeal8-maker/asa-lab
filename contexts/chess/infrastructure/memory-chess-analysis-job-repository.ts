import {
  immutableChessAnalysisJob,
  type ChessAnalysisJob,
} from '../application/chess-analysis-job.js';
import type {
  ChessAnalysisJobCreateResult,
  ChessAnalysisJobRepositoryPort,
  ChessAnalysisJobSaveResult,
} from '../application/chess-analysis-job-ports.js';

function key(...parts: readonly string[]): string {
  return parts.join('\u0000');
}

function immutableFieldsMatch(left: ChessAnalysisJob, right: ChessAnalysisJob): boolean {
  return (
    left.id === right.id &&
    left.tenantPartition === right.tenantPartition &&
    left.requestedBy === right.requestedBy &&
    left.idempotencyKey === right.idempotencyKey &&
    left.requestFingerprint === right.requestFingerprint &&
    left.maxAttempts === right.maxAttempts &&
    left.createdAtMs === right.createdAtMs &&
    JSON.stringify(left.request) === JSON.stringify(right.request)
  );
}

export class MemoryChessAnalysisJobRepository implements ChessAnalysisJobRepositoryPort {
  private readonly jobs = new Map<string, ChessAnalysisJob>();
  private readonly idempotency = new Map<string, string>();
  calls = 0;

  async create(job: ChessAnalysisJob): Promise<ChessAnalysisJobCreateResult> {
    this.calls += 1;
    const idempotencyKey = key(job.tenantPartition, job.requestedBy, job.idempotencyKey);
    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId) {
      const existing = this.jobs.get(key(job.tenantPartition, existingId));
      if (!existing) throw new Error('In-memory idempotency index is inconsistent.');
      return { kind: 'existing', job: immutableChessAnalysisJob(existing) };
    }
    const jobKey = key(job.tenantPartition, job.id);
    if (this.jobs.has(jobKey)) return { kind: 'id_conflict' };
    this.jobs.set(jobKey, immutableChessAnalysisJob(job));
    this.idempotency.set(idempotencyKey, job.id);
    return { kind: 'created', job: immutableChessAnalysisJob(job) };
  }

  async get(tenantPartition: string, jobId: string): Promise<ChessAnalysisJob | null> {
    this.calls += 1;
    const job = this.jobs.get(key(tenantPartition, jobId));
    return job ? immutableChessAnalysisJob(job) : null;
  }

  async save(job: ChessAnalysisJob, expectedVersion: number): Promise<ChessAnalysisJobSaveResult> {
    this.calls += 1;
    const jobKey = key(job.tenantPartition, job.id);
    const current = this.jobs.get(jobKey);
    if (!current) return 'not_found';
    if (
      current.version !== expectedVersion ||
      job.version !== expectedVersion + 1 ||
      !immutableFieldsMatch(current, job)
    ) {
      return 'conflict';
    }
    this.jobs.set(jobKey, immutableChessAnalysisJob(job));
    return 'saved';
  }
}
