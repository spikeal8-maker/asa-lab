import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { hashSessionToken, type ActiveContextUseCase } from '@asa-lab/identity';
import {
  PERSONAL_PROGRESS_GROUP_LIMIT,
  GROUP_RATING_PAGE_LIMIT,
  type GroupRatingPageV1,
  type GroupRatingAvatarBatchV1,
  type GroupRatingOwnV1,
  type GroupRatingPeerV1,
  type OwnGroupResultV1,
  type OwnProgressGroupV1,
  type PersonalProgressSummaryV1,
  type ProgressAvailabilityV1,
  type ProgressCounterV1,
  type ProgressCoverageV1,
  type ProgressMetricNameV1,
  type ProgressScopeV1,
} from '@asa-lab/contracts';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METRICS: readonly ProgressMetricNameV1[] = [
  'everPublishedWorks',
  'currentLikes',
  'createdCopies',
  'activePublicWorks',
];
const BASES: Record<ProgressMetricNameV1, ProgressCoverageV1['basis']> = {
  everPublishedWorks: 'confirmed_publication_revisions',
  currentLikes: 'current_publication_likes',
  createdCopies: 'durable_publication_copy_receipts',
  activePublicWorks: 'current_catalog_visibility',
};

/** Ticket privacy requires a server-only key independent of the learner's
 * own cookie, which is potentially inspectable by that learner. The optional
 * stable deployment key allows tickets to survive API replica handoffs.
 * Without one, each API process uses a strong ephemeral secret and restarting
 * invalidates outstanding pages (the client may start again). No fail-open
 * deterministic fallback is allowed. Never log or expose the secret.
 */
const RATING_TICKET_MASTER_KEY = (() => {
  const configured = process.env['ASA_SP04_TICKET_SECRET'];
  if (configured !== undefined && configured !== '') {
    if (!/^[a-fA-F0-9]{64}$/.test(configured))
      throw new Error('ASA_SP04_TICKET_SECRET must be a 32-byte hexadecimal server secret');
    return Buffer.from(configured, 'hex');
  }
  return randomBytes(32);
})();

/** SP-04 cursors and avatar tickets are AES-GCM authenticated and scoped to
 * the current session under an independent server-held secret. */
function ratingTicketKey(token: string): Buffer {
  return createHmac('sha256', RATING_TICKET_MASTER_KEY)
    .update('asa:sp04:ticket:v1:')
    .update(hashSessionToken(token))
    .digest();
}

function sealRatingTicket(token: string, fields: readonly unknown[]): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ratingTicketKey(token), nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(fields), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function unsealRatingTicket(token: string, value: unknown): unknown[] {
  if (
    typeof value !== 'string' ||
    value.length < 45 ||
    value.length > 1024 ||
    !/^[a-zA-Z0-9_-]+$/.test(value)
  )
    throw failure('validation_error', 400, 'Некорректная страница рейтинга.');
  try {
    const packet = Buffer.from(value, 'base64url');
    if (packet.length < 29 || packet.toString('base64url') !== value)
      throw new Error('noncanonical');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      ratingTicketKey(token),
      packet.subarray(0, 12),
    );
    decipher.setAuthTag(packet.subarray(12, 28));
    const decoded = JSON.parse(
      Buffer.concat([decipher.update(packet.subarray(28)), decipher.final()]).toString('utf8'),
    ) as unknown;
    if (!Array.isArray(decoded)) throw new Error('not_array');
    return decoded;
  } catch {
    throw failure('validation_error', 400, 'Некорректная страница рейтинга.');
  }
}

function ratingPeerKey(token: string, classId: string, seatId: string): string {
  return createHmac('sha256', ratingTicketKey(token))
    .update('peer:' + classId + ':' + seatId)
    .digest('base64url')
    .slice(0, 27);
}

/** Mirror the existing FNV-1a default-avatar choice for ASCII UUIDs. */
function ratingDefaultAvatar(seatId: string, avatarKey: unknown): string {
  const chosen =
    typeof avatarKey === 'string' && /^asa-avatar-(0[1-9]|[1-5][0-9]|6[0-7])$/.test(avatarKey)
      ? Number(avatarKey.slice(-2))
      : null;
  let hash = 2166136261;
  for (const letter of seatId) {
    hash ^= letter.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const index = chosen ?? (Math.abs(hash) % 67) + 1;
  return '/assets/avatars/default/avatar-' + String(index).padStart(2, '0') + '.webp';
}

function ratingScore(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.000001
  )
    return unavailable();
  return value;
}

function ratingRank(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return unavailable();
  return value;
}

function ratingValuePair(
  score: unknown,
  rank: unknown,
): {
  score: number | null;
  rank: number | null;
} {
  const actualScore = ratingScore(score);
  const actualRank = ratingRank(rank);
  if ((actualScore === null) !== (actualRank === null)) return unavailable();
  return { score: actualScore, rank: actualRank };
}

function ratingOwn(input: unknown): GroupRatingOwnV1 {
  const own = object(input);
  if (
    own.availability === 'unavailable' &&
    own.score === null &&
    own.rank === null &&
    (own.reason === 'source_unavailable' || own.reason === 'rating_disabled')
  ) {
    return {
      isSelf: true,
      availability: 'unavailable',
      score: null,
      rank: null,
      reason: own.reason,
    };
  }
  if (own.availability !== 'available') return unavailable();
  const pair = ratingValuePair(own.score, own.rank);
  return { isSelf: true, availability: 'available', ...pair };
}

function failure(code: string, status: number, message: string): HttpException {
  return new HttpException({ error: { code, message } }, status);
}

function unavailable(): never {
  throw failure('progress_unavailable', 503, 'Сводка сейчас недоступна.');
}

async function resolveContext<T>(resolve: () => Promise<T>): Promise<T> {
  try {
    return await resolve();
  } catch (cause) {
    if (cause instanceof HttpException) throw cause;
    return unavailable();
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}

function availability(value: unknown): ProgressAvailabilityV1 {
  if (value === 'available' || value === 'partial' || value === 'unavailable') return value;
  return unavailable();
}

function timestamp(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value;
  return unavailable();
}

function counter(value: unknown): ProgressCounterV1 {
  const row = object(value);
  if (
    row.availability === 'available' &&
    typeof row.value === 'number' &&
    Number.isSafeInteger(row.value) &&
    row.value >= 0
  )
    return { availability: 'available', value: row.value };
  if (
    row.availability === 'unavailable' &&
    row.value === null &&
    row.reason === 'source_unavailable'
  ) {
    return { availability: 'unavailable', value: null, reason: 'source_unavailable' };
  }
  return unavailable();
}

function coverage(value: unknown, metric: ProgressMetricNameV1): ProgressCoverageV1 {
  const row = object(value);
  if (
    row.basis !== BASES[metric] ||
    (row.completeness !== 'complete' &&
      row.completeness !== 'partial' &&
      row.completeness !== 'unknown') ||
    !Array.isArray(row.limitations) ||
    row.limitations.length > 2
  )
    return unavailable();
  const limitations = row.limitations.map((item): ProgressCoverageV1['limitations'][number] => {
    if (
      item === 'history_before_canonical_records_unknown' ||
      item === 'copies_not_supported_by_all_modules'
    )
      return item;
    return unavailable();
  });
  return {
    basis: BASES[metric],
    completeness: row.completeness,
    knownSince: timestamp(row.knownSince),
    limitations,
  };
}

function ownResult(value: unknown): OwnGroupResultV1 {
  const row = object(value);
  if (
    row.availability === 'unavailable' &&
    row.score === null &&
    row.rank === null &&
    (row.reason === 'ambiguous_self_participant' || row.reason === 'source_unavailable')
  ) {
    return { availability: 'unavailable', score: null, rank: null, reason: row.reason };
  }
  if (row.availability !== 'available') return unavailable();
  const score = row.score,
    rank = row.rank;
  if (score === null && rank === null) return { availability: 'available', score, rank };
  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100 ||
    typeof rank !== 'number' ||
    !Number.isSafeInteger(rank) ||
    rank < 1
  )
    return unavailable();
  return { availability: 'available', score, rank };
}

function group(value: unknown): OwnProgressGroupV1 {
  const row = object(value);
  if (
    typeof row.groupId !== 'string' ||
    !UUID.test(row.groupId) ||
    typeof row.title !== 'string' ||
    row.title.length > 255 ||
    (row.periodDays !== 7 && row.periodDays !== 30 && row.periodDays !== 90)
  )
    return unavailable();
  return {
    groupId: row.groupId,
    title: row.title,
    periodDays: row.periodDays,
    own: ownResult(row.own),
  };
}

function scopeKey(scope: ProgressScopeV1): string {
  return scope.kind === 'account'
    ? `account:${scope.accountId}`
    : `seat:${scope.seatId}:${scope.classroomId}`;
}

function cursor(scope: ProgressScopeV1, after: string): string {
  return Buffer.from(JSON.stringify([1, scopeKey(scope), after]), 'utf8').toString('base64url');
}

/** An opaque page boundary is context-bound, never an authorization credential. */
function pageAfter(query: Record<string, unknown>, scope: ProgressScopeV1): string | null {
  const invalid = () => failure('validation_error', 400, 'Некорректная страница сводки.');
  if (Object.keys(query).some((key) => key !== 'cursor')) throw invalid();
  if (query.cursor === undefined) return null;
  if (
    typeof query.cursor !== 'string' ||
    query.cursor.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(query.cursor)
  )
    throw invalid();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value[0] !== 1 ||
    value[1] !== scopeKey(scope) ||
    typeof value[2] !== 'string' ||
    !UUID.test(value[2]) ||
    cursor(scope, value[2]) !== query.cursor
  )
    throw invalid();
  return value[2];
}

/** Construct every field explicitly; internal SQL/roster fields cannot enter this DTO. */
function summary(value: unknown, scope: ProgressScopeV1): PersonalProgressSummaryV1 {
  const row = object(value),
    actualScope = object(row.scope);
  if (
    actualScope.kind !== scope.kind ||
    (scope.kind === 'account'
      ? actualScope.accountId !== scope.accountId
      : actualScope.seatId !== scope.seatId || actualScope.classroomId !== scope.classroomId)
  )
    return unavailable();
  const rawMetrics = object(row.metrics),
    rawCoverage = object(row.coverage);
  const metrics = {} as Record<ProgressMetricNameV1, ProgressCounterV1>;
  const coverages = {} as Record<ProgressMetricNameV1, ProgressCoverageV1>;
  for (const metric of METRICS) {
    metrics[metric] = counter(rawMetrics[metric]);
    coverages[metric] = coverage(rawCoverage[metric], metric);
  }
  const rating = object(row.personalRating);
  if (rating.availability !== 'not_enabled' || rating.value !== null) return unavailable();
  const groups = object(row.groups);
  const groupsAvailability = availability(groups.availability);
  let items: OwnProgressGroupV1[] | null = null;
  let hasMore: boolean | null = null;
  let nextCursor: string | null = null;
  if (groupsAvailability === 'unavailable') {
    if (groups.items !== null || groups.hasMore !== null || groups.nextGroupId !== null)
      return unavailable();
  } else {
    if (
      !Array.isArray(groups.items) ||
      groups.items.length > PERSONAL_PROGRESS_GROUP_LIMIT ||
      typeof groups.hasMore !== 'boolean'
    )
      return unavailable();
    items = groups.items.map(group);
    hasMore = groups.hasMore;
    if (
      new Set(items.map((item) => item.groupId)).size !== items.length ||
      (scope.kind === 'seat' &&
        (items.length > 1 || items.some((item) => item.groupId !== scope.classroomId)))
    )
      return unavailable();
    if (
      groupsAvailability !==
      (items.some((item) => item.own.availability === 'unavailable') ? 'partial' : 'available')
    )
      return unavailable();
    if (hasMore) {
      if (
        items.length !== PERSONAL_PROGRESS_GROUP_LIMIT ||
        typeof groups.nextGroupId !== 'string' ||
        groups.nextGroupId !== items.at(-1)?.groupId
      )
        return unavailable();
      nextCursor = cursor(scope, groups.nextGroupId);
    } else if (groups.nextGroupId !== null) return unavailable();
  }
  const metricStates = METRICS.map((metric) => metrics[metric].availability);
  const expected =
    groupsAvailability === 'unavailable' && metricStates.every((state) => state === 'unavailable')
      ? 'unavailable'
      : groupsAvailability !== 'available' || metricStates.some((state) => state === 'unavailable')
        ? 'partial'
        : 'available';
  if (availability(row.availability) !== expected) return unavailable();
  const asOf = timestamp(row.asOf);
  if (expected !== 'unavailable' && asOf === null) return unavailable();
  return {
    scope,
    asOf,
    availability: expected,
    metrics,
    coverage: coverages,
    personalRating: { availability: 'not_enabled', value: null },
    groups: { availability: groupsAvailability, items, hasMore, nextCursor },
  };
}

@Controller('api')
export class PersonalProgressController {
  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Inject(TOKENS.activeContextUseCase) private readonly accounts: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool) throw failure('database_unavailable', 503, 'База данных недоступна.');
    return this.pool;
  }

  private async read(
    pool: pg.Pool,
    scope: ProgressScopeV1,
    principal: string,
    token: string,
    query: Record<string, unknown>,
  ) {
    const after = pageAfter(query, scope);
    try {
      const result = await pool.query<{ result: unknown }>(
        'SELECT public.personal_progress_summary($1,$2,$3,$4,$5) AS result',
        [
          scope.kind,
          scope.kind === 'account' ? scope.accountId : scope.seatId,
          principal,
          hashSessionToken(token),
          after,
        ],
      );
      return summary(result.rows[0]?.result, scope);
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
      if (code === 'P6S01') throw failure('unauthorized', 401, 'Войдите заново.');
      if (code === 'P6S02')
        throw failure('progress_owner_unavailable', 403, 'Учебный профиль сейчас недоступен.');
      return unavailable();
    }
  }

  /** One verified, bounded projection; neither client query nor raw SQL ids
   * can select an identity or grant access to an unrelated class. */
  private async ratingRead(
    scope: ProgressScopeV1,
    principal: string,
    token: string,
    groupId: string,
    query: Record<string, unknown>,
  ): Promise<GroupRatingPageV1> {
    if (
      !UUID.test(groupId) ||
      Object.keys(query).some((key) => !['view', 'cursor', 'limit'].includes(key))
    )
      throw failure('validation_error', 400, 'Некорректная учебная группа.');
    const view = query.view === undefined ? 'preview' : query.view;
    if (view !== 'preview' && view !== 'all')
      throw failure('validation_error', 400, 'Некорректный режим рейтинга.');
    if (view !== 'all' && query.cursor !== undefined)
      throw failure('validation_error', 400, 'Курсор доступен только в полном рейтинге.');
    if (view === 'all' && query.limit !== undefined)
      throw failure('validation_error', 400, 'Размер полного рейтинга фиксирован.');
    const previewLimit = query.limit === undefined ? 5 : Number(query.limit);
    if (
      view === 'preview' &&
      ((typeof query.limit !== 'undefined' &&
        (typeof query.limit !== 'string' || !/^[1-5]$/.test(query.limit))) ||
        !Number.isSafeInteger(previewLimit) ||
        previewLimit < 1 ||
        previewLimit > 5)
    )
      throw failure('validation_error', 400, 'Недействительный размер рейтинга.');
    let afterScore: number | null = null;
    let afterSeat: string | null = null;
    let version: string | null = null;
    if (query.cursor !== undefined) {
      const parts = unsealRatingTicket(token, query.cursor);
      if (
        parts.length !== 6 ||
        parts[0] !== 1 ||
        parts[1] !== 'page' ||
        parts[2] !== groupId ||
        typeof parts[3] !== 'string' ||
        !/^[a-f0-9]{32}$/.test(parts[3]) ||
        typeof parts[4] !== 'string' ||
        !UUID.test(parts[4]) ||
        (parts[5] !== null && typeof parts[5] !== 'number')
      )
        throw failure('validation_error', 400, 'Недействительный курсор рейтинга.');
      version = parts[3];
      afterSeat = parts[4];
      afterScore = ratingScore(parts[5]);
    }
    const limit = view === 'all' ? GROUP_RATING_PAGE_LIMIT : previewLimit;
    let raw: Record<string, unknown>;
    try {
      const rows = await this.requirePool().query<{ result: unknown }>(
        'SELECT public.personal_progress_group_rating($1,$2,$3,$4,$5,$6,$7,$8) AS result',
        [
          scope.kind,
          scope.kind === 'account' ? scope.accountId : scope.seatId,
          principal,
          hashSessionToken(token),
          groupId,
          afterScore,
          afterSeat,
          limit,
        ],
      );
      raw = object(rows.rows[0]?.result);
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
      if (code === 'P6S01') throw failure('unauthorized', 401, 'Сессия недействительна.');
      if (code === 'P6S02') throw failure('group_forbidden', 403, 'Учебная группа недоступна.');
      if (code === 'P6S03') throw failure('validation_error', 400, 'Недействительная страница.');
      return unavailable();
    }
    if (
      raw.groupId !== groupId ||
      (raw.periodDays !== 7 && raw.periodDays !== 30 && raw.periodDays !== 90) ||
      typeof raw.version !== 'string' ||
      !/^[a-f0-9]{32}$/.test(raw.version) ||
      typeof raw.asOf !== 'string' ||
      !Number.isFinite(Date.parse(raw.asOf))
    )
      return unavailable();
    if (version !== null && version !== raw.version)
      throw failure('progress_rating_stale', 409, 'Рейтинг обновился. Начните загрузку сначала.');
    if (!Array.isArray(raw.peers) || raw.peers.length > limit || typeof raw.hasMore !== 'boolean')
      return unavailable();
    const seen = new Set<string>();
    const peers: GroupRatingPeerV1[] = raw.peers.map((value): GroupRatingPeerV1 => {
      const peer = object(value);
      if (
        typeof peer.seatId !== 'string' ||
        !UUID.test(peer.seatId) ||
        (scope.kind === 'seat' && peer.seatId === scope.seatId) ||
        seen.has(peer.seatId) ||
        (peer.avatarKey !== null && typeof peer.avatarKey !== 'string') ||
        (peer.avatarId !== null && (typeof peer.avatarId !== 'string' || !UUID.test(peer.avatarId)))
      )
        return unavailable();
      seen.add(peer.seatId);
      const pair = ratingValuePair(peer.score, peer.rank);
      return {
        peerKey: ratingPeerKey(token, groupId, peer.seatId),
        avatarSrc: ratingDefaultAvatar(peer.seatId, peer.avatarKey),
        avatarTicket:
          peer.avatarId === null
            ? null
            : sealRatingTicket(token, [1, 'image', groupId, peer.seatId]),
        ...pair,
        isSelf: false,
      };
    });
    if (raw.hasMore === true) {
      if (
        peers.length !== limit ||
        typeof raw.afterSeat !== 'string' ||
        !UUID.test(raw.afterSeat) ||
        raw.afterSeat !== object(raw.peers.at(-1)).seatId ||
        raw.afterScore !== object(raw.peers.at(-1)).score
      )
        return unavailable();
    } else if (raw.afterSeat !== null || raw.afterScore !== null) return unavailable();
    const nextCursor =
      raw.hasMore && typeof raw.afterSeat === 'string'
        ? sealRatingTicket(token, [1, 'page', groupId, raw.version, raw.afterSeat, raw.afterScore])
        : null;
    return {
      groupId,
      periodDays: raw.periodDays,
      version: raw.version,
      asOf: raw.asOf,
      own: ratingOwn(raw.own),
      peers,
      hasMore: raw.hasMore,
      nextCursor,
    };
  }

  private async avatarRead(
    scope: ProgressScopeV1,
    principal: string,
    token: string,
    groupId: string,
    body: unknown,
  ): Promise<GroupRatingAvatarBatchV1> {
    if (!UUID.test(groupId)) throw failure('validation_error', 400, 'Некорректная учебная группа.');
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('tickets' in body) ||
      !Array.isArray(body.tickets) ||
      body.tickets.length > GROUP_RATING_PAGE_LIMIT
    )
      throw failure('validation_error', 400, 'Недействительный набор аватаров.');
    const tickets = body.tickets as unknown[];
    const seen = new Set<string>();
    const seats = tickets.map((ticket) => {
      const parts = unsealRatingTicket(token, ticket);
      if (
        parts.length !== 4 ||
        parts[0] !== 1 ||
        parts[1] !== 'image' ||
        parts[2] !== groupId ||
        typeof parts[3] !== 'string' ||
        !UUID.test(parts[3]) ||
        seen.has(parts[3])
      )
        throw failure('validation_error', 400, 'Недействительный ключ аватара.');
      seen.add(parts[3]);
      return parts[3];
    });
    let raw: unknown;
    try {
      const rows = await this.requirePool().query<{ result: unknown }>(
        'SELECT public.personal_progress_group_avatar_batch($1,$2,$3,$4,$5,$6::uuid[]) AS result',
        [
          scope.kind,
          scope.kind === 'account' ? scope.accountId : scope.seatId,
          principal,
          hashSessionToken(token),
          groupId,
          seats,
        ],
      );
      raw = rows.rows[0]?.result;
    } catch (cause) {
      if (cause instanceof HttpException) throw cause;
      const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
      if (code === 'P6S01') throw failure('unauthorized', 401, 'Сессия недействительна.');
      if (code === 'P6S02') throw failure('group_forbidden', 403, 'Учебная группа недоступна.');
      if (code === 'P6S03')
        throw failure('validation_error', 400, 'Недействительный набор аватаров.');
      return unavailable();
    }
    if (!Array.isArray(raw) || raw.length > seats.length) return unavailable();
    const seenImages = new Set<string>();
    const images = new Map<string, string>();
    for (const item of raw) {
      const result = object(item);
      if (
        typeof result.seatId !== 'string' ||
        !seen.has(result.seatId) ||
        seenImages.has(result.seatId) ||
        typeof result.dataUrl !== 'string' ||
        result.dataUrl.length > 300000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(result.dataUrl)
      )
        return unavailable();
      seenImages.add(result.seatId);
      images.set(result.seatId, result.dataUrl);
    }
    return {
      items: tickets.flatMap((ticket, i) => {
        const dataUrl = images.get(seats[i] as string);
        return typeof ticket === 'string' && dataUrl ? [{ ticket, dataUrl }] : [];
      }),
    };
  }

  @Get('progress/groups/:groupId/rating')
  @Header('Cache-Control', 'private, no-store')
  async accountRating(
    @Req() request: FastifyRequest,
    @Param('groupId') groupId: string,
    @Query() query: Record<string, unknown> = {},
  ) {
    const token = request.cookies[SESSION_COOKIE];
    const context = await resolveContext(() => this.accounts.resolve(token));
    if (!token || !context) throw failure('unauthorized', 401, 'Войдите в аккаунт.');
    return this.ratingRead(
      { kind: 'account', accountId: context.accountId },
      context.principalId,
      token,
      groupId,
      query,
    );
  }

  @Get('class-join/progress/groups/:groupId/rating')
  @Header('Cache-Control', 'private, no-store')
  async seatRating(
    @Req() request: FastifyRequest,
    @Param('groupId') groupId: string,
    @Query() query: Record<string, unknown> = {},
  ) {
    const token = request.cookies[STUDENT_SESSION_COOKIE];
    const resolved = await resolveContext(() => this.seats.resolveExistingState(token));
    if (!token || resolved.state === 'invalid_session')
      throw failure('unauthorized', 401, 'Войдите в учебную группу.');
    if (resolved.state === 'unavailable_owner')
      throw failure('group_forbidden', 403, 'Учебная группа недоступна.');
    const seat = resolved.context;
    return this.ratingRead(
      { kind: 'seat', seatId: seat.seatId, classroomId: seat.classroomId },
      seat.principalId,
      token,
      groupId,
      query,
    );
  }

  @Post('progress/groups/:groupId/avatars')
  @Header('Cache-Control', 'private, no-store')
  async accountRatingAvatars(
    @Req() request: FastifyRequest,
    @Param('groupId') groupId: string,
    @Body() body: unknown,
  ) {
    const token = request.cookies[SESSION_COOKIE];
    const context = await resolveContext(() => this.accounts.resolve(token));
    if (!token || !context) throw failure('unauthorized', 401, 'Войдите в аккаунт.');
    return this.avatarRead(
      { kind: 'account', accountId: context.accountId },
      context.principalId,
      token,
      groupId,
      body,
    );
  }

  @Post('class-join/progress/groups/:groupId/avatars')
  @Header('Cache-Control', 'private, no-store')
  async seatRatingAvatars(
    @Req() request: FastifyRequest,
    @Param('groupId') groupId: string,
    @Body() body: unknown,
  ) {
    const token = request.cookies[STUDENT_SESSION_COOKIE];
    const resolved = await resolveContext(() => this.seats.resolveExistingState(token));
    if (!token || resolved.state === 'invalid_session')
      throw failure('unauthorized', 401, 'Войдите в учебную группу.');
    if (resolved.state === 'unavailable_owner')
      throw failure('group_forbidden', 403, 'Учебная группа недоступна.');
    const seat = resolved.context;
    return this.avatarRead(
      { kind: 'seat', seatId: seat.seatId, classroomId: seat.classroomId },
      seat.principalId,
      token,
      groupId,
      body,
    );
  }

  @Get('progress/summary')
  @Header('Cache-Control', 'private, no-store')
  async account(@Req() request: FastifyRequest, @Query() query: Record<string, unknown> = {}) {
    const pool = this.requirePool();
    const token = request.cookies[SESSION_COOKIE];
    const context = await resolveContext(() => this.accounts.resolve(token));
    if (!token || !context) throw failure('unauthorized', 401, 'Войдите в аккаунт.');
    return this.read(
      pool,
      { kind: 'account', accountId: context.accountId },
      context.principalId,
      token,
      query,
    );
  }

  @Get('class-join/progress/summary')
  @Header('Cache-Control', 'private, no-store')
  async seat(@Req() request: FastifyRequest, @Query() query: Record<string, unknown> = {}) {
    const pool = this.requirePool();
    const token = request.cookies[STUDENT_SESSION_COOKIE];
    const resolved = await resolveContext(() => this.seats.resolveExistingState(token));
    if (!token || resolved.state === 'invalid_session')
      throw failure('unauthorized', 401, 'Войдите в класс заново.');
    if (resolved.state === 'unavailable_owner')
      throw failure('progress_owner_unavailable', 403, 'Учебный профиль сейчас недоступен.');
    const seat = resolved.context;
    return this.read(
      pool,
      { kind: 'seat', seatId: seat.seatId, classroomId: seat.classroomId },
      seat.principalId,
      token,
      query,
    );
  }
}
