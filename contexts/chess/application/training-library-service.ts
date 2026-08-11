import { applyMoveUnchecked, findLegalMoveByUci, parseFen, toFen } from '../domain/chess.js';
import {
  deterministicChessTrainingAttemptId,
  deterministicChessTrainingId,
  isCanonicalTrainingTimestamp,
  isSafeTrainingPartitionId,
  validatePrivateChessTrainingRecord,
  type ChessTrainingAttempt,
  type ChessTrainingHintLevel,
  type ChessTrainingSource,
  type PrivateChessTrainingRecord,
} from './training-library-model.js';
import type {
  ChessTrainingLibraryRepositoryPort,
  ChessTrainingPartition,
} from './training-library-repository.js';

export type ChessTrainingLibraryErrorCode =
  'invalid' | 'not_found' | 'conflict' | 'finished' | 'forbidden' | 'id_collision';

export type ChessTrainingLibraryResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: ChessTrainingLibraryErrorCode;
      readonly message: string;
    };

export interface AuthenticatedChessTrainingContext {
  readonly authenticationId: string;
}

export type ChessTrainingLibraryAction =
  | { readonly kind: 'create' }
  | { readonly kind: 'list' }
  | { readonly kind: 'load'; readonly trainingItemId: string }
  | { readonly kind: 'record_attempt'; readonly trainingItemId: string };

export type ChessTrainingAuthorizationDecision =
  | { readonly allowed: true; readonly partition: ChessTrainingPartition }
  | { readonly allowed: false };

export interface ChessTrainingAuthorizationPort {
  authorize(input: {
    readonly context: AuthenticatedChessTrainingContext;
    readonly action: ChessTrainingLibraryAction;
  }): Promise<ChessTrainingAuthorizationDecision>;
}

export interface ChessTrainingSourceReference {
  readonly projectId: string;
  readonly projectVersionId: string;
  readonly ply: number;
}

export interface ChessTrainingSourceResolverPort {
  resolve(input: {
    readonly partition: ChessTrainingPartition;
    readonly reference: ChessTrainingSourceReference;
  }): Promise<ChessTrainingSource | null>;
}

export interface CreateChessTrainingInput {
  readonly createdAt: string;
  readonly sourceReference: ChessTrainingSourceReference;
}

export interface RecordChessTrainingAttemptInput {
  readonly trainingItemId: string;
  readonly operationId: string;
  readonly occurredAt: string;
  readonly moveUci: string;
  readonly hintsUsed: 0 | 1 | 2 | 3;
}

function failure(
  code: ChessTrainingLibraryErrorCode,
  message: string,
): ChessTrainingLibraryResult<never> {
  return { ok: false, code, message };
}

function invalid(message: string): ChessTrainingLibraryResult<never> {
  return failure('invalid', message);
}

function validatePartition(partition: ChessTrainingPartition): ChessTrainingLibraryResult<true> {
  if (
    !isSafeTrainingPartitionId(partition.tenantId) ||
    !isSafeTrainingPartitionId(partition.ownerId)
  ) {
    return invalid('Authorized training tenantId and ownerId must be safe and non-empty.');
  }
  return { ok: true, value: true };
}

function validateSourceReference(
  reference: ChessTrainingSourceReference,
): ChessTrainingLibraryResult<true> {
  if (
    !isSafeTrainingPartitionId(reference.projectId) ||
    !isSafeTrainingPartitionId(reference.projectVersionId) ||
    !Number.isSafeInteger(reference.ply) ||
    reference.ply < 1 ||
    reference.ply > 1000
  ) {
    return invalid('Training source reference is invalid.');
  }
  return { ok: true, value: true };
}

function sourceMatchesReference(
  source: ChessTrainingSource,
  reference: ChessTrainingSourceReference,
): boolean {
  return (
    source.projectId === reference.projectId &&
    source.projectVersionId === reference.projectVersionId &&
    source.ply === reference.ply
  );
}

function sourceIdentity(source: ChessTrainingSource): string {
  return JSON.stringify([
    source.projectId,
    source.projectVersionId,
    source.reviewAlgorithm,
    source.ply,
    source.color,
    source.classification,
    source.fenBefore,
    source.fenAfter,
    source.playedUci,
    source.bestUci,
    source.bestFenAfter,
  ]);
}

function hints(count: 0 | 1 | 2 | 3): readonly { readonly level: ChessTrainingHintLevel }[] {
  return Array.from({ length: count }, (_, index) => ({
    level: (index + 1) as ChessTrainingHintLevel,
  }));
}

function attemptMatchesRequest(
  attempt: ChessTrainingAttempt,
  input: RecordChessTrainingAttemptInput,
): boolean {
  return (
    attempt.operationId === input.operationId &&
    attempt.occurredAt === input.occurredAt &&
    attempt.moveUci === input.moveUci &&
    attempt.hints.length === input.hintsUsed
  );
}

function samePersistedAttempt(left: ChessTrainingAttempt, right: ChessTrainingAttempt): boolean {
  return (
    left.id === right.id &&
    left.trainingItemId === right.trainingItemId &&
    left.operationId === right.operationId &&
    left.sequence === right.sequence &&
    left.occurredAt === right.occurredAt &&
    left.moveUci === right.moveUci &&
    left.outcome === right.outcome &&
    left.positionAfterMoveFen === right.positionAfterMoveFen &&
    left.resetFen === right.resetFen &&
    left.hints.length === right.hints.length &&
    left.hints.every((hint, index) => hint.level === right.hints[index]?.level)
  );
}

function preservesImmutableRecordPrefix(
  before: PrivateChessTrainingRecord,
  after: PrivateChessTrainingRecord,
): boolean {
  return (
    before.id === after.id &&
    before.tenantId === after.tenantId &&
    before.ownerId === after.ownerId &&
    before.createdAt === after.createdAt &&
    sourceIdentity(before.source) === sourceIdentity(after.source) &&
    after.attempts.length >= before.attempts.length &&
    before.attempts.every((attempt, index) => samePersistedAttempt(attempt, after.attempts[index]!))
  );
}

export class ChessTrainingLibraryService {
  constructor(
    private readonly repository: ChessTrainingLibraryRepositoryPort,
    private readonly authorization: ChessTrainingAuthorizationPort,
    private readonly sourceResolver: ChessTrainingSourceResolverPort,
  ) {}

  private async authorize(
    context: AuthenticatedChessTrainingContext,
    action: ChessTrainingLibraryAction,
  ): Promise<ChessTrainingLibraryResult<ChessTrainingPartition>> {
    const decision = await this.authorization.authorize({ context, action });
    if (!decision.allowed) {
      return failure('forbidden', 'Private Chess training access is forbidden.');
    }
    const checked = validatePartition(decision.partition);
    return checked.ok ? { ok: true, value: decision.partition } : checked;
  }

  private validateRepositoryRecord(
    value: unknown,
    partition: ChessTrainingPartition,
  ): ChessTrainingLibraryResult<PrivateChessTrainingRecord> {
    const validated = validatePrivateChessTrainingRecord(value);
    if (!validated.ok)
      return invalid(`Training repository returned invalid data: ${validated.message}`);
    if (
      validated.value.tenantId !== partition.tenantId ||
      validated.value.ownerId !== partition.ownerId
    ) {
      return invalid('Training repository returned a record from another private partition.');
    }
    return { ok: true, value: validated.value };
  }

  async create(
    context: AuthenticatedChessTrainingContext,
    input: CreateChessTrainingInput,
  ): Promise<ChessTrainingLibraryResult<PrivateChessTrainingRecord>> {
    const authorized = await this.authorize(context, { kind: 'create' });
    if (!authorized.ok) return authorized;
    const reference = validateSourceReference(input.sourceReference);
    if (!reference.ok) return reference;
    if (!isCanonicalTrainingTimestamp(input.createdAt)) {
      return invalid('Training record createdAt is invalid.');
    }
    const source = await this.sourceResolver.resolve({
      partition: authorized.value,
      reference: input.sourceReference,
    });
    if (!source) {
      return failure('not_found', 'An authoritative reviewed project version was not found.');
    }
    if (!sourceMatchesReference(source, input.sourceReference)) {
      return invalid('The authoritative training source does not match its requested version.');
    }
    const record: PrivateChessTrainingRecord = {
      schemaVersion: 2,
      kind: 'review-mistake-training',
      visibility: 'private',
      id: deterministicChessTrainingId({ ...authorized.value, source }),
      tenantId: authorized.value.tenantId,
      ownerId: authorized.value.ownerId,
      createdAt: input.createdAt,
      source,
      attempts: [],
    };
    const validated = validatePrivateChessTrainingRecord(record);
    if (!validated.ok) return invalid(validated.message);
    const created = await this.repository.create(validated.value);
    if (created.status === 'id_collision') {
      return failure(
        'id_collision',
        'The deterministic training id is already bound to different provenance.',
      );
    }
    const stored = this.validateRepositoryRecord(created.record, authorized.value);
    if (!stored.ok) return stored;
    if (
      stored.value.id !== validated.value.id ||
      sourceIdentity(stored.value.source) !== sourceIdentity(validated.value.source)
    ) {
      return failure(
        'id_collision',
        'The deterministic training id resolved to different provenance.',
      );
    }
    return stored;
  }

  async list(
    context: AuthenticatedChessTrainingContext,
  ): Promise<ChessTrainingLibraryResult<readonly PrivateChessTrainingRecord[]>> {
    const authorized = await this.authorize(context, { kind: 'list' });
    if (!authorized.ok) return authorized;
    const records = await this.repository.list(authorized.value);
    const validated: PrivateChessTrainingRecord[] = [];
    for (const record of records) {
      const checked = this.validateRepositoryRecord(record, authorized.value);
      if (!checked.ok) return checked;
      validated.push(checked.value);
    }
    return { ok: true, value: Object.freeze(validated) };
  }

  async load(
    context: AuthenticatedChessTrainingContext,
    trainingItemId: string,
  ): Promise<ChessTrainingLibraryResult<PrivateChessTrainingRecord>> {
    const authorized = await this.authorize(context, { kind: 'load', trainingItemId });
    if (!authorized.ok) return authorized;
    if (!isSafeTrainingPartitionId(trainingItemId)) return invalid('Training item id is invalid.');
    const record = await this.repository.load(authorized.value, trainingItemId);
    if (!record) return failure('not_found', 'Private training item was not found.');
    return this.validateRepositoryRecord(record, authorized.value);
  }

  async recordAttempt(
    context: AuthenticatedChessTrainingContext,
    input: RecordChessTrainingAttemptInput,
  ): Promise<ChessTrainingLibraryResult<PrivateChessTrainingRecord>> {
    const authorized = await this.authorize(context, {
      kind: 'record_attempt',
      trainingItemId: input.trainingItemId,
    });
    if (!authorized.ok) return authorized;
    if (!isSafeTrainingPartitionId(input.trainingItemId)) {
      return invalid('Training item id is invalid.');
    }
    if (!isSafeTrainingPartitionId(input.operationId)) {
      return invalid('Training attempt operationId is invalid.');
    }
    if (!isCanonicalTrainingTimestamp(input.occurredAt)) {
      return invalid('Training attempt occurredAt is invalid.');
    }
    if (!Number.isSafeInteger(input.hintsUsed) || input.hintsUsed < 0 || input.hintsUsed > 3) {
      return invalid('Training attempt hintsUsed is invalid.');
    }

    const rawRecord = await this.repository.load(authorized.value, input.trainingItemId);
    if (!rawRecord) return failure('not_found', 'Private training item was not found.');
    const loaded = this.validateRepositoryRecord(rawRecord, authorized.value);
    if (!loaded.ok) return loaded;

    const root = parseFen(loaded.value.source.fenBefore);
    if (!root.ok) return invalid(root.message);
    const move = findLegalMoveByUci(root.value, input.moveUci);
    if (!move) return invalid('Training attempt move must be legal at the reviewed root.');

    const existingAttempt = loaded.value.attempts.find(
      (attempt) => attempt.operationId === input.operationId,
    );
    if (existingAttempt) {
      return attemptMatchesRequest(existingAttempt, input)
        ? loaded
        : failure('conflict', 'Training attempt operationId was reused with different input.');
    }
    if (loaded.value.attempts.some((attempt) => attempt.outcome === 'solved')) {
      return failure('finished', 'The private training item is already solved.');
    }
    const previousTimestamp = Date.parse(
      loaded.value.attempts.at(-1)?.occurredAt ?? loaded.value.createdAt,
    );
    if (Date.parse(input.occurredAt) < previousTimestamp) {
      return invalid('Training attempt occurredAt must not precede the existing history.');
    }

    const sequence = loaded.value.attempts.length + 1;
    const outcome = input.moveUci === loaded.value.source.bestUci ? 'solved' : 'incorrect';
    const attempt: ChessTrainingAttempt = {
      id: deterministicChessTrainingAttemptId(loaded.value.id, sequence),
      trainingItemId: loaded.value.id,
      operationId: input.operationId,
      sequence,
      occurredAt: input.occurredAt,
      moveUci: input.moveUci,
      outcome,
      positionAfterMoveFen: toFen(applyMoveUnchecked(root.value, move)),
      resetFen: outcome === 'incorrect' ? loaded.value.source.fenBefore : null,
      hints: hints(input.hintsUsed),
    };
    const next: PrivateChessTrainingRecord = {
      ...loaded.value,
      attempts: [...loaded.value.attempts, attempt],
    };
    const validated = validatePrivateChessTrainingRecord(next);
    if (!validated.ok) return invalid(validated.message);
    const saved = await this.repository.appendAttempt({
      partition: authorized.value,
      trainingItemId: input.trainingItemId,
      expectedAttemptCount: loaded.value.attempts.length,
      attempt,
    });
    if (saved.status === 'not_found') {
      return failure('not_found', 'Private training item was not found.');
    }
    if (saved.status === 'conflict') {
      const recoveredRaw = await this.repository.load(authorized.value, input.trainingItemId);
      if (!recoveredRaw) return failure('not_found', 'Private training item was not found.');
      const recovered = this.validateRepositoryRecord(recoveredRaw, authorized.value);
      if (!recovered.ok) return recovered;
      if (!preservesImmutableRecordPrefix(loaded.value, recovered.value)) {
        return invalid('Training repository rewrote immutable attempt history.');
      }
      const recoveredAttempt = recovered.value.attempts.find(
        (candidate) => candidate.operationId === input.operationId,
      );
      return recoveredAttempt && attemptMatchesRequest(recoveredAttempt, input)
        ? recovered
        : failure('conflict', 'Training attempt history changed.');
    }
    if (saved.status === 'invalid') {
      return invalid('Training attempt was rejected by the repository.');
    }
    const stored = this.validateRepositoryRecord(saved.record, authorized.value);
    if (!stored.ok) return stored;
    if (!preservesImmutableRecordPrefix(loaded.value, stored.value)) {
      return invalid('Training repository rewrote immutable attempt history.');
    }
    const persistedAttempt = stored.value.attempts.find(
      (candidate) => candidate.operationId === input.operationId,
    );
    if (!persistedAttempt || !attemptMatchesRequest(persistedAttempt, input)) {
      return invalid('Training repository returned a different idempotent attempt result.');
    }
    return stored;
  }
}
