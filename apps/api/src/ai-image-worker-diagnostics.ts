import { emitApplicationLog } from './application-log-store.js';
import { ComfyTransportError } from './ai-image-comfyui.js';
import { AiAttachmentStorageError } from './ai-attachments/blob-store.js';

export type AiImageWorkerStage =
  | 'claim'
  | 'cleanup_remove'
  | 'cleanup_ack'
  | 'dispatch_claim'
  | 'provider_configuration'
  | 'dispatch'
  | 'storage_verify'
  | 'recover'
  | 'output_validate'
  | 'transition'
  | 'storage_prepare'
  | 'storage_put'
  | 'storage_cleanup';

export type AiImageWorkerLog = (text: string) => boolean | void;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const WINDOW_MS = 60_000;
const MAX_REPORTS = 30;
const CODES = new Set([
  'ai_image_provider_configuration',
  'ai_image_provider_unavailable',
  'ai_image_provider_invalid',
  'ai_image_dispatch_unknown',
  'ai_image_output_invalid',
  'ai_image_storage_unavailable',
  'ai_image_unavailable',
]);
const DATABASE_CODES: Readonly<Record<string, string>> = {
  '40001': 'ai_image_database_serialization',
  '40P01': 'ai_image_database_deadlock',
  '57014': 'ai_image_database_timeout',
  '53300': 'ai_image_database_capacity',
  '08001': 'ai_image_database_connection',
  '08006': 'ai_image_database_connection',
  '57P01': 'ai_image_database_connection',
};

/** Inspect only closed codes/classes. Never serialize a thrown object or its message/name/stack. */
function failure(problem: unknown): { errorCode: string; errorClass: string } {
  try {
    if (problem instanceof AiAttachmentStorageError)
      return {
        errorClass: 'AiAttachmentStorageError',
        errorCode:
          problem.outcome === 'not_written'
            ? 'ai_image_storage_rejected'
            : problem.outcome === 'integrity'
              ? 'ai_image_storage_integrity'
              : 'ai_image_storage_uncertain',
      };
    const code =
      problem && typeof problem === 'object' ? (problem as { code?: unknown }).code : null;
    if (typeof code === 'string' && Object.hasOwn(DATABASE_CODES, code))
      return { errorCode: DATABASE_CODES[code]!, errorClass: 'DatabaseError' };
    return {
      errorCode: typeof code === 'string' && CODES.has(code) ? code : 'ai_image_worker_exception',
      errorClass:
        problem instanceof ComfyTransportError
          ? 'ComfyTransportError'
          : problem instanceof TypeError
            ? 'TypeError'
            : problem instanceof RangeError
              ? 'RangeError'
              : problem instanceof SyntaxError
                ? 'SyntaxError'
                : problem instanceof Error
                  ? 'Error'
                  : 'Unknown',
    };
  } catch {
    return { errorCode: 'ai_image_worker_exception', errorClass: 'Unknown' };
  }
}

/** Diagnostic delivery never participates in job admission, leases, fencing or recovery. */
export class AiImageWorkerDiagnostics {
  private readonly counters = {
    failuresObserved: 0,
    failureReportAttempts: 0,
    failuresSuppressed: 0,
    logWriteExceptions: 0,
    healthReportAttempts: 0,
  };
  private readonly seen = new Set<string>();
  private windowStarted: number;
  private lastHealth: number;
  private reports = 0;
  private dirty = false;

  constructor(
    private readonly emit: AiImageWorkerLog = (text) => emitApplicationLog(text, 'stderr'),
    private readonly now: () => number = () => performance.now(),
  ) {
    this.windowStarted = this.lastHealth = this.now();
  }

  snapshot() {
    return { ...this.counters };
  }

  report(stage: AiImageWorkerStage, jobId: unknown, attemptId: string, problem: unknown): void {
    const now = this.now();
    if (now - this.windowStarted >= WINDOW_MS) {
      this.windowStarted = now;
      this.reports = 0;
      this.seen.clear();
    }
    this.counters.failuresObserved++;
    this.dirty = true;
    const safeId = typeof jobId === 'string' && UUID.test(jobId) ? jobId.toLowerCase() : null;
    const detail = failure(problem);
    const key = `${safeId}:${stage}:${detail.errorCode}:${detail.errorClass}`;
    if (this.seen.has(key) || this.reports >= MAX_REPORTS) {
      this.counters.failuresSuppressed++;
      return;
    }
    this.seen.add(key);
    this.reports++;
    this.counters.failureReportAttempts++;
    this.write({
      kind: 'ai_image_worker_failure',
      level: 'error',
      phase: stage,
      ...detail,
      runtime: {
        worker: 'ai_image',
        stage,
        jobId: safeId,
        // Independent diagnostic ID, never the SQL lease/fencing capability.
        attemptId: UUID.test(attemptId) ? attemptId.toLowerCase() : null,
      },
    });
  }

  health(force = false): void {
    if (!this.dirty || (!force && this.now() - this.lastHealth < WINDOW_MS)) return;
    this.lastHealth = this.now();
    this.counters.healthReportAttempts++;
    this.dirty = false;
    this.write({
      kind: 'ai_image_worker_health',
      level: this.counters.failuresSuppressed || this.counters.logWriteExceptions ? 'warn' : 'info',
      phase: 'maintenance',
      runtime: { worker: 'ai_image' },
      delivery:
        this.counters.logWriteExceptions > 0
          ? 'log_write_exceptions'
          : this.counters.failuresSuppressed > 0
            ? 'rate_limited'
            : 'reported',
    });
  }

  private write(detail: Record<string, unknown>): void {
    try {
      this.emit(
        JSON.stringify({
          time: new Date().toISOString(),
          module: 'portal',
          path: '/api/ai/image-generations',
          ...detail,
          counters: this.snapshot(),
        }) + '\n',
      );
    } catch {
      this.counters.logWriteExceptions++;
      this.dirty = true;
    }
  }
}
