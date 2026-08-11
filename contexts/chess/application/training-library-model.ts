import {
  applyMoveUnchecked,
  findLegalMoveByUci,
  parseFen,
  toFen,
  type Color,
} from '../domain/chess.js';

export type ChessTrainingReviewAlgorithm = 'asa-review-v1';
export type ChessTrainingErrorClassification = 'mistake' | 'blunder';
export type ChessTrainingAttemptOutcome = 'incorrect' | 'solved';
export type ChessTrainingHintLevel = 1 | 2 | 3;

export interface ChessTrainingSource {
  readonly projectId: string;
  readonly projectVersionId: string;
  readonly reviewAlgorithm: ChessTrainingReviewAlgorithm;
  readonly ply: number;
  readonly color: Color;
  readonly classification: ChessTrainingErrorClassification;
  readonly fenBefore: string;
  readonly fenAfter: string;
  readonly playedUci: string;
  readonly bestUci: string;
  readonly bestFenAfter: string;
}

export interface ChessTrainingAttemptHint {
  readonly level: ChessTrainingHintLevel;
}

export interface ChessTrainingAttempt {
  readonly id: string;
  readonly trainingItemId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly moveUci: string;
  readonly outcome: ChessTrainingAttemptOutcome;
  readonly resultFen: string;
  readonly hints: readonly ChessTrainingAttemptHint[];
}

export interface PrivateChessTrainingRecord {
  readonly schemaVersion: 1;
  readonly kind: 'review-mistake-training';
  readonly visibility: 'private';
  readonly id: string;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly source: ChessTrainingSource;
  readonly attempts: readonly ChessTrainingAttempt[];
}

export type ChessTrainingValidationResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const RECORD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'visibility',
  'id',
  'tenantId',
  'ownerId',
  'createdAt',
  'source',
  'attempts',
]);
const SOURCE_KEYS = new Set([
  'projectId',
  'projectVersionId',
  'reviewAlgorithm',
  'ply',
  'color',
  'classification',
  'fenBefore',
  'fenAfter',
  'playedUci',
  'bestUci',
  'bestFenAfter',
]);
const ATTEMPT_KEYS = new Set([
  'id',
  'trainingItemId',
  'sequence',
  'occurredAt',
  'moveUci',
  'outcome',
  'resultFen',
  'hints',
]);
const HINT_KEYS = new Set(['level']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return (
    Object.keys(value).every((key) => keys.has(key)) && Object.keys(value).length === keys.size
  );
}

export function isSafeTrainingPartitionId(value: string): boolean {
  return SAFE_ID.test(value);
}

export function isCanonicalTrainingTimestamp(value: string): boolean {
  if (value.length > 40) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function fnv1a32(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function deterministicChessTrainingId(input: {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly source: ChessTrainingSource;
}): string {
  const canonical = JSON.stringify([
    input.tenantId,
    input.ownerId,
    input.source.projectId,
    input.source.projectVersionId,
    input.source.reviewAlgorithm,
    input.source.ply,
    input.source.color,
    input.source.classification,
    input.source.fenBefore,
    input.source.fenAfter,
    input.source.playedUci,
    input.source.bestUci,
    input.source.bestFenAfter,
  ]);
  return `chess-training_${fnv1a32(canonical, 0x811c9dc5)}${fnv1a32(canonical, 0x9e3779b9)}`;
}

export function deterministicChessTrainingAttemptId(recordId: string, sequence: number): string {
  return `${recordId}:attempt:${sequence.toString().padStart(4, '0')}`;
}

function validateSource(value: unknown): ChessTrainingValidationResult<ChessTrainingSource> {
  if (!isObject(value) || !hasExactKeys(value, SOURCE_KEYS)) {
    return { ok: false, message: 'Training source must contain only the supported fields.' };
  }
  for (const key of ['projectId', 'projectVersionId'] as const) {
    if (typeof value[key] !== 'string' || !SAFE_ID.test(value[key])) {
      return { ok: false, message: `Training source ${key} must be safe and non-empty.` };
    }
  }
  if (value['reviewAlgorithm'] !== 'asa-review-v1') {
    return { ok: false, message: 'Training source reviewAlgorithm is unsupported.' };
  }
  if (
    !Number.isSafeInteger(value['ply']) ||
    Number(value['ply']) < 1 ||
    Number(value['ply']) > 1000
  ) {
    return { ok: false, message: 'Training source ply must be from 1 to 1000.' };
  }
  if (value['color'] !== 'white' && value['color'] !== 'black') {
    return { ok: false, message: 'Training source color is invalid.' };
  }
  if (value['classification'] !== 'mistake' && value['classification'] !== 'blunder') {
    return { ok: false, message: 'Training source must be a mistake or blunder.' };
  }
  for (const key of ['fenBefore', 'fenAfter', 'bestFenAfter'] as const) {
    if (typeof value[key] !== 'string') {
      return { ok: false, message: `Training source ${key} must be a FEN string.` };
    }
  }
  for (const key of ['playedUci', 'bestUci'] as const) {
    if (typeof value[key] !== 'string' || !UCI.test(value[key])) {
      return { ok: false, message: `Training source ${key} must use UCI notation.` };
    }
  }
  if (value['playedUci'] === value['bestUci']) {
    return { ok: false, message: 'Training source best move must differ from the played move.' };
  }
  const root = parseFen(value['fenBefore'] as string);
  if (!root.ok || toFen(root.value) !== value['fenBefore']) {
    return { ok: false, message: 'Training source fenBefore must be canonical and legal.' };
  }
  if (root.value.turn !== value['color']) {
    return { ok: false, message: 'Training source color must match the root side to move.' };
  }
  const played = findLegalMoveByUci(root.value, value['playedUci'] as string);
  const best = findLegalMoveByUci(root.value, value['bestUci'] as string);
  if (!played || !best) {
    return {
      ok: false,
      message: 'Training source played and best moves must be legal at the root.',
    };
  }
  if (toFen(applyMoveUnchecked(root.value, played)) !== value['fenAfter']) {
    return { ok: false, message: 'Training source fenAfter does not match the played move.' };
  }
  if (toFen(applyMoveUnchecked(root.value, best)) !== value['bestFenAfter']) {
    return { ok: false, message: 'Training source bestFenAfter does not match the best move.' };
  }
  return { ok: true, value: value as unknown as ChessTrainingSource };
}

function validateAttempts(
  value: unknown,
  recordId: string,
  source: ChessTrainingSource,
): ChessTrainingValidationResult<readonly ChessTrainingAttempt[]> {
  if (!Array.isArray(value) || value.length > 1000) {
    return { ok: false, message: 'Training attempts must be a bounded array.' };
  }
  const root = parseFen(source.fenBefore);
  if (!root.ok) return root;
  const attempts: ChessTrainingAttempt[] = [];
  let solved = false;
  for (const [index, raw] of value.entries()) {
    if (!isObject(raw) || !hasExactKeys(raw, ATTEMPT_KEYS)) {
      return { ok: false, message: `Training attempt ${index + 1} has unsupported fields.` };
    }
    const sequence = index + 1;
    if (
      raw['sequence'] !== sequence ||
      raw['id'] !== deterministicChessTrainingAttemptId(recordId, sequence) ||
      raw['trainingItemId'] !== recordId
    ) {
      return { ok: false, message: `Training attempt ${sequence} identity is invalid.` };
    }
    if (typeof raw['occurredAt'] !== 'string' || !isCanonicalTrainingTimestamp(raw['occurredAt'])) {
      return { ok: false, message: `Training attempt ${sequence} timestamp is invalid.` };
    }
    if (typeof raw['moveUci'] !== 'string' || !UCI.test(raw['moveUci'])) {
      return { ok: false, message: `Training attempt ${sequence} move is invalid.` };
    }
    const move = findLegalMoveByUci(root.value, raw['moveUci']);
    if (!move) return { ok: false, message: `Training attempt ${sequence} move is illegal.` };
    const expectedOutcome: ChessTrainingAttemptOutcome =
      raw['moveUci'] === source.bestUci ? 'solved' : 'incorrect';
    if (solved || raw['outcome'] !== expectedOutcome) {
      return { ok: false, message: `Training attempt ${sequence} outcome is invalid.` };
    }
    const expectedFen = expectedOutcome === 'solved' ? source.bestFenAfter : source.fenBefore;
    if (raw['resultFen'] !== expectedFen) {
      return { ok: false, message: `Training attempt ${sequence} resultFen is invalid.` };
    }
    if (!Array.isArray(raw['hints']) || raw['hints'].length > 3) {
      return { ok: false, message: `Training attempt ${sequence} hints are invalid.` };
    }
    for (const [hintIndex, hint] of raw['hints'].entries()) {
      if (!isObject(hint) || !hasExactKeys(hint, HINT_KEYS) || hint['level'] !== hintIndex + 1) {
        return { ok: false, message: `Training attempt ${sequence} hint history is invalid.` };
      }
    }
    attempts.push(raw as unknown as ChessTrainingAttempt);
    solved = expectedOutcome === 'solved';
  }
  return { ok: true, value: attempts };
}

function immutableRecord(record: PrivateChessTrainingRecord): PrivateChessTrainingRecord {
  const source = Object.freeze({ ...record.source });
  const attempts = Object.freeze(
    record.attempts.map((attempt) =>
      Object.freeze({
        ...attempt,
        hints: Object.freeze(attempt.hints.map((hint) => Object.freeze({ ...hint }))),
      }),
    ),
  );
  return Object.freeze({ ...record, source, attempts });
}

export function validatePrivateChessTrainingRecord(
  value: unknown,
): ChessTrainingValidationResult<PrivateChessTrainingRecord> {
  if (!isObject(value) || !hasExactKeys(value, RECORD_KEYS)) {
    return { ok: false, message: 'Training record must contain only the supported fields.' };
  }
  if (
    value['schemaVersion'] !== 1 ||
    value['kind'] !== 'review-mistake-training' ||
    value['visibility'] !== 'private'
  ) {
    return { ok: false, message: 'Training record schema, kind or visibility is invalid.' };
  }
  for (const key of ['tenantId', 'ownerId'] as const) {
    if (typeof value[key] !== 'string' || !SAFE_ID.test(value[key])) {
      return { ok: false, message: `Training record ${key} must be safe and non-empty.` };
    }
  }
  if (typeof value['createdAt'] !== 'string' || !isCanonicalTrainingTimestamp(value['createdAt'])) {
    return { ok: false, message: 'Training record createdAt is invalid.' };
  }
  const source = validateSource(value['source']);
  if (!source.ok) return source;
  const expectedId = deterministicChessTrainingId({
    tenantId: value['tenantId'] as string,
    ownerId: value['ownerId'] as string,
    source: source.value,
  });
  if (value['id'] !== expectedId) {
    return { ok: false, message: 'Training record id is not deterministic for its provenance.' };
  }
  const attempts = validateAttempts(value['attempts'], expectedId, source.value);
  if (!attempts.ok) return attempts;
  return {
    ok: true,
    value: immutableRecord({
      schemaVersion: 1,
      kind: 'review-mistake-training',
      visibility: 'private',
      id: expectedId,
      tenantId: value['tenantId'] as string,
      ownerId: value['ownerId'] as string,
      createdAt: value['createdAt'] as string,
      source: source.value,
      attempts: attempts.value,
    }),
  };
}

export function serializePrivateChessTrainingRecord(
  value: PrivateChessTrainingRecord,
): ChessTrainingValidationResult<string> {
  const validated = validatePrivateChessTrainingRecord(value);
  return validated.ok
    ? { ok: true, value: JSON.stringify(validated.value) }
    : { ok: false, message: validated.message };
}

export function deserializePrivateChessTrainingRecord(
  value: string,
): ChessTrainingValidationResult<PrivateChessTrainingRecord> {
  try {
    return validatePrivateChessTrainingRecord(JSON.parse(value) as unknown);
  } catch {
    return { ok: false, message: 'Training record JSON is invalid.' };
  }
}
