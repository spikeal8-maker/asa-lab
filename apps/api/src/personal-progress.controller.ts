import { Controller, Get, Header, HttpException, Inject, Query, Req } from '@nestjs/common';
import { hashSessionToken, type ActiveContextUseCase } from '@asa-lab/identity';
import {
  PERSONAL_PROGRESS_GROUP_LIMIT,
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

function failure(code: string, status: number, message: string): HttpException {
  return new HttpException({ error: { code, message } }, status);
}

function unavailable(): never {
  throw failure('progress_unavailable', 503, 'Сводка сейчас недоступна.');
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

  @Get('progress/summary')
  @Header('Cache-Control', 'private, no-store')
  async account(@Req() request: FastifyRequest, @Query() query: Record<string, unknown> = {}) {
    const pool = this.requirePool();
    const token = request.cookies[SESSION_COOKIE];
    const context = await this.accounts.resolve(token);
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
    const resolved = await this.seats.resolveExistingState(token);
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
