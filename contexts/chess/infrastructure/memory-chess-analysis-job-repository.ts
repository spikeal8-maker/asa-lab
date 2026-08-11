import type { ChessAnalysisJob } from '../application/chess-analysis-job.js';
import type {
  ChessAnalysisJobCreateResult,
  ChessAnalysisJobRepositoryPort,
  ChessAnalysisJobSaveResult,
} from '../application/chess-analysis-job-ports.js';

function key(partition: string, value: string): string {
  return `${partition}\u0000${value}`;
}

export class MemoryChessAnalysisJobRepository implements ChessAnalysisJobRepositoryPort {
  private readonly jobs = new Map<string, ChessAnalysisJob>();
  private readonly idempotency = new Map<string, string>();
  calls = 0;

  async create(job: ChessAnalysisJob): Promise<ChessAnalysisJobCreateResult> {
    this.calls += 1;
    const idempotencyKey = key(job.tenantPartition, job.idempotencyKey);
    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId) {
      const existing = this.jobs.get(key(job.tenantPartition, existingId));
      if (!existing) throw new Error('In-memory idempotency index is inconsistent.');
      return { kind: 'existing', job: structuredClone(existing) };
    }
    this.jobs.set(key(job.tenantPartition, job.id), structuredClone(job));
    this.idempotency.set(idempotencyKey, job.id);
    return { kind: 'created', job: structuredClone(job) };
  }

  async get(tenantPartition: string, jobId: string): Promise<ChessAnalysisJob | null> {
    this.calls += 1;
    const job = this.jobs.get(key(tenantPartition, jobId));
    return job ? structuredClone(job) : null;
  }

  async save(job: ChessAnalysisJob, expectedVersion: number): Promise<ChessAnalysisJobSaveResult> {
    this.calls += 1;
    const jobKey = key(job.tenantPartition, job.id);
    const current = this.jobs.get(jobKey);
    if (!current) return 'not_found';
    if (current.version !== expectedVersion) return 'conflict';
    this.jobs.set(jobKey, structuredClone(job));
    return 'saved';
  }
}
