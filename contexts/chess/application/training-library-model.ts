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
  readonly operationId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly moveUci: string;
  readonly outcome: ChessTrainingAttemptOutcome;
  readonly positionAfterMoveFen: string;
  readonly resetFen: string | null;
  readonly hints: readonly ChessTrainingAttemptHint[];
}

export interface PrivateChessTrainingRecord {
  readonly schemaVersion: 2;
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
  'operationId',
  'sequence',
  'occurredAt',
  'moveUci',
  'outcome',
  'positionAfterMoveFen',
  'resetFen',
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

const SHA256_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(input);
  message[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15]!;
      const before2 = words[index - 2]!;
      const sigma0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const sigma1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((part) => part.toString(16).padStart(8, '0'))
    .join('');
}

export function deterministicChessTrainingId(input: {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly source: ChessTrainingSource;
}): string {
  const canonical = JSON.stringify([
    'chess-training-id-v2',
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
  return `chess-training_${sha256Hex(canonical)}`;
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
  createdAt: string,
): ChessTrainingValidationResult<readonly ChessTrainingAttempt[]> {
  if (!Array.isArray(value) || value.length > 1000) {
    return { ok: false, message: 'Training attempts must be a bounded array.' };
  }
  const root = parseFen(source.fenBefore);
  if (!root.ok) return root;
  const attempts: ChessTrainingAttempt[] = [];
  const operationIds = new Set<string>();
  let previousTimestamp = Date.parse(createdAt);
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
    if (
      typeof raw['operationId'] !== 'string' ||
      !SAFE_ID.test(raw['operationId']) ||
      operationIds.has(raw['operationId'])
    ) {
      return { ok: false, message: `Training attempt ${sequence} operationId is invalid.` };
    }
    if (typeof raw['occurredAt'] !== 'string' || !isCanonicalTrainingTimestamp(raw['occurredAt'])) {
      return { ok: false, message: `Training attempt ${sequence} timestamp is invalid.` };
    }
    const currentTimestamp = Date.parse(raw['occurredAt']);
    if (currentTimestamp < previousTimestamp) {
      return { ok: false, message: `Training attempt ${sequence} timestamp is out of order.` };
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
    const expectedPositionAfterMoveFen = toFen(applyMoveUnchecked(root.value, move));
    if (raw['positionAfterMoveFen'] !== expectedPositionAfterMoveFen) {
      return {
        ok: false,
        message: `Training attempt ${sequence} positionAfterMoveFen is invalid.`,
      };
    }
    const expectedResetFen = expectedOutcome === 'incorrect' ? source.fenBefore : null;
    if (raw['resetFen'] !== expectedResetFen) {
      return { ok: false, message: `Training attempt ${sequence} resetFen is invalid.` };
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
    operationIds.add(raw['operationId']);
    previousTimestamp = currentTimestamp;
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
    value['schemaVersion'] !== 2 ||
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
  const attempts = validateAttempts(
    value['attempts'],
    expectedId,
    source.value,
    value['createdAt'] as string,
  );
  if (!attempts.ok) return attempts;
  return {
    ok: true,
    value: immutableRecord({
      schemaVersion: 2,
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
