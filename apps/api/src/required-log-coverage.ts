import databaseContract from './database-diagnostic-contract.json';
import type { LogCatalog } from './admin-logs.worker.js';

export type CoverageState = 'ok' | 'incomplete' | 'unknown';
export interface RequiredSourceRule {
  readonly source: string;
  readonly applicable: boolean;
  readonly maxAgeSeconds: number;
  readonly requireThrough: boolean;
  readonly reason?: 'other-platform';
}
export interface RequiredSourcesDeclaration {
  readonly version: 1;
  readonly policy: 'asa-connected-v1';
  readonly platform: 'linux' | 'windows';
  readonly auditMaxAgeSeconds: number;
  readonly sources: readonly RequiredSourceRule[];
}
export interface NativeCoverage {
  readonly state: CoverageState;
  readonly reason: string;
  readonly counters?: {
    readonly accepted: number;
    readonly persisted: number;
    readonly dropped: number;
    readonly failures: number;
    readonly pending: number;
  };
}
export interface RequiredCoverage {
  readonly version: 1;
  readonly policy: 'asa-connected-v1';
  readonly state: CoverageState;
  readonly requiredSourceIds: readonly string[];
  readonly excludedSourceIds: readonly string[];
  readonly sources: readonly {
    source: string;
    state: CoverageState;
    reason: string;
    checkedAt: string | null;
    collectedThrough: string | null;
    maxAgeSeconds: number;
    requireThrough: boolean;
  }[];
  readonly native: NativeCoverage;
  readonly historyAudit: {
    readonly state: CoverageState;
    readonly reason: string;
    readonly lastCompletedAt: string | null;
  };
  readonly limitations: readonly string[];
}

const WINDOWS = ['windows', 'windows:Application', 'windows:System', 'windows:Security'];
const LINUX = ['linux:journal'];
const BASE = [
  'docker',
  'database-events',
  'metrics',
  'docker-lifecycle',
  'operations:updates',
  'operations:backup',
  ...['api', 'web', 'scratch', 'postgres', 'minio'].map((id) => `${id}:recent`),
  ...Object.keys(databaseContract.sources).map((id) => `database-events:${id}`),
];
const limitations = [
  'Finite required connected-source coverage; global retained history is not complete.',
  'Unconfigured external sources and unknown pre-installation or abrupt-termination tails are not proven.',
];
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function boundedAge(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 10 && Number(value) <= 900;
}
function sourceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (/^[a-z][a-zA-Z0-9_.:-]{0,127}$/.test(value) ||
      (value.startsWith('windows:') && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)))
  );
}
function otherPlatformSource(source: string, platform: string): boolean {
  return platform === 'linux'
    ? source === 'windows' || source.startsWith('windows:')
    : LINUX.includes(source);
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.exec(
    value,
  );
  if (!match) return false;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  return (
    year >= 1970 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= new Date(Date.UTC(year, month, 0)).getUTCDate() &&
    Number.isFinite(Date.parse(value))
  );
}
function fresh(value: unknown, maxAgeSeconds: number, now: number): value is string {
  return (
    timestamp(value) &&
    now - Date.parse(value) >= -5000 &&
    now - Date.parse(value) <= maxAgeSeconds * 1000
  );
}

/** Invalid optional metadata never breaks legacy search, nor becomes healthy coverage. */
export function readRequiredSources(value: unknown): RequiredSourcesDeclaration | undefined {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.policy !== 'asa-connected-v1' ||
    (value.platform !== 'linux' && value.platform !== 'windows') ||
    !boundedAge(value.auditMaxAgeSeconds) ||
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > 256
  )
    return undefined;
  const seen = new Set<string>();
  for (const rule of value.sources) {
    if (
      !record(rule) ||
      !sourceId(rule.source) ||
      seen.has(rule.source) ||
      typeof rule.applicable !== 'boolean' ||
      typeof rule.requireThrough !== 'boolean' ||
      !boundedAge(rule.maxAgeSeconds) ||
      (!rule.applicable &&
        (rule.reason !== 'other-platform' || !otherPlatformSource(rule.source, value.platform))) ||
      (rule.applicable && otherPlatformSource(rule.source, value.platform))
    )
      return undefined;
    seen.add(rule.source);
  }
  return value as unknown as RequiredSourcesDeclaration;
}

/** Full catalog metadata is required even when all reported source states say ok. */
export function completeCatalogMetadata(catalog: LogCatalog): boolean {
  if (
    !timestamp(catalog.collectedAt) ||
    !Number.isSafeInteger(catalog.retentionDays) ||
    catalog.retentionDays < 1 ||
    catalog.retentionDays > 365 ||
    !Number.isSafeInteger(catalog.maxBytes) ||
    catalog.maxBytes <= 0 ||
    !Number.isSafeInteger(catalog.bytes) ||
    catalog.bytes < 0 ||
    catalog.bytes > catalog.maxBytes ||
    typeof catalog.trimmed !== 'boolean' ||
    catalog.sources.length > 512 ||
    catalog.sources.some((source) => !sourceId(source?.source)) ||
    catalog.segments.length > 32768
  )
    return false;
  const files = new Set<string>();
  let total = 0;
  for (const segment of catalog.segments) {
    if (
      !segment ||
      typeof segment.file !== 'string' ||
      !/^seg-\d{16}-\d{16}\.jsonl(?:\.gz)?$/.test(segment.file) ||
      files.has(segment.file) ||
      !Number.isSafeInteger(segment.bytes) ||
      segment.bytes < 1 ||
      segment.bytes > 4 * 1024 * 1024 ||
      !Number.isSafeInteger(segment.rawBytes) ||
      Number(segment.rawBytes) < 1 ||
      Number(segment.rawBytes) > 4 * 1024 * 1024 ||
      typeof segment.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(segment.sha256) ||
      !Number.isSafeInteger(segment.count) ||
      segment.count < 1 ||
      !timestamp(segment.first) ||
      !timestamp(segment.last) ||
      segment.first > segment.last ||
      !Array.isArray(segment.sources) ||
      !Array.isArray(segment.modules) ||
      !Array.isArray(segment.levels)
    )
      return false;
    files.add(segment.file);
    total += segment.bytes;
  }
  return total === catalog.bytes;
}

export function unknownRequiredCoverage(reason: string): RequiredCoverage {
  return {
    version: 1,
    policy: 'asa-connected-v1',
    state: 'unknown',
    requiredSourceIds: [],
    excludedSourceIds: [],
    sources: [],
    native: { state: 'unknown', reason: 'native_writer_unavailable' },
    historyAudit: { state: 'unknown', reason, lastCompletedAt: null },
    limitations,
  };
}

export function hostRequiredCoverage(
  catalog: LogCatalog | null,
  health: { state: string; checkedAt: string } | null,
  now = Date.now(),
): RequiredCoverage {
  const declaration = catalog?.requiredSources;
  if (!catalog || !declaration || !completeCatalogMetadata(catalog))
    return unknownRequiredCoverage('required_catalog_metadata_missing_or_invalid');
  const observedLive = catalog.sources
    .filter(
      (source) =>
        typeof source?.source === 'string' &&
        (source.source.endsWith(':recent') ||
          /^(?:database-events:|operations:|provider:)/.test(source.source)),
    )
    .map((source) => source.source);
  const expected = [
    ...BASE,
    ...observedLive,
    ...(declaration.platform === 'linux' ? LINUX : WINDOWS),
  ];
  const rules = new Map(
    declaration.sources.filter((rule) => rule.applicable).map((rule) => [rule.source, rule]),
  );
  const requiredSourceIds = [...new Set([...rules.keys(), ...expected])].sort();
  const excludedSourceIds = declaration.sources
    .filter((rule) => !rule.applicable)
    .map((rule) => rule.source)
    .sort();
  const policyComplete = [...LINUX, ...WINDOWS].every((id) =>
    declaration.sources.some((rule) => rule.source === id),
  );
  const sourceIds = catalog.sources.map((source) => source?.source);
  if (
    sourceIds.some((id) => typeof id !== 'string') ||
    new Set(sourceIds).size !== sourceIds.length
  )
    return unknownRequiredCoverage('source_identity_invalid');
  const sources = requiredSourceIds.map((id) => {
    const rule = rules.get(id);
    const source = catalog.sources.find((row) => row.source === id);
    const maxAgeSeconds = rule?.maxAgeSeconds ?? 300;
    const requireThrough = rule?.requireThrough ?? true;
    const reason = !rule
      ? 'required_policy_source_missing'
      : !source
        ? 'required_source_missing'
        : source.state !== 'ok'
          ? `source_${['pending', 'error', 'unavailable'].includes(source.state) ? source.state : 'unknown'}`
          : [source.applicable, source.stale, source.possibleCoverageGap, source.incomplete].some(
                (flag) => flag !== undefined && typeof flag !== 'boolean',
              ) ||
              !timestamp(source.checkedAt) ||
              !timestamp(source.lastCollectedAt) ||
              (requireThrough && !timestamp(source.collectedThrough))
            ? 'source_metadata_unknown'
            : source.applicable === false
              ? 'applicability_mismatch'
              : source.stale === true ||
                  source.possibleCoverageGap === true ||
                  source.incomplete === true
                ? 'source_gap_or_stale'
                : !fresh(source.checkedAt, maxAgeSeconds, now) ||
                    !fresh(source.lastCollectedAt, maxAgeSeconds, now)
                  ? 'source_freshness_unproven'
                  : requireThrough && !fresh(source.collectedThrough, maxAgeSeconds, now)
                    ? 'source_through_unproven'
                    : 'verified';
    return {
      source: id,
      state:
        reason === 'verified'
          ? ('ok' as const)
          : reason === 'source_unknown' || reason === 'source_metadata_unknown'
            ? ('unknown' as const)
            : ('incomplete' as const),
      reason,
      checkedAt: timestamp(source?.checkedAt) ? source.checkedAt : null,
      collectedThrough: timestamp(source?.collectedThrough) ? source.collectedThrough : null,
      maxAgeSeconds,
      requireThrough,
    };
  });
  const audit = catalog.historyAudit;
  let historyAudit: RequiredCoverage['historyAudit'] = {
    state: 'unknown',
    reason: 'audit_evidence_missing_or_invalid',
    lastCompletedAt: null,
  };
  if (
    record(audit) &&
    typeof audit.state === 'string' &&
    ['complete', 'running', 'overdue', 'error'].includes(audit.state) &&
    typeof audit.generation === 'string' &&
    audit.generation.length > 0 &&
    audit.generation.length <= 64 &&
    Number.isSafeInteger(audit.checked) &&
    Number(audit.checked) >= 0 &&
    Number.isSafeInteger(audit.total) &&
    Number(audit.total) >= Number(audit.checked) &&
    typeof audit.incomplete === 'boolean' &&
    Number.isFinite(audit.deadline)
  ) {
    const completed =
      audit.state === 'complete'
        ? (audit.completedAt ?? audit.lastCompletedAt)
        : audit.lastCompletedAt;
    const valid =
      !audit.incomplete &&
      fresh(completed, declaration.auditMaxAgeSeconds, now) &&
      ((audit.state === 'complete' && audit.checked === audit.total) ||
        (audit.state === 'running' && now <= Number(audit.deadline) * 1000));
    historyAudit = {
      state: valid ? 'ok' : 'incomplete',
      reason: valid ? 'recent_retained_integrity_verified' : 'audit_incomplete_or_stale',
      lastCompletedAt: timestamp(completed) ? completed : null,
    };
  }
  const hostHealthy =
    !catalog.sources.some(
      (source) => source.state === 'error' && !excludedSourceIds.includes(source.source),
    ) &&
    health?.state === 'ok' &&
    fresh(health.checkedAt, 300, now) &&
    fresh(catalog.collectedAt, 300, now);
  const state =
    historyAudit.state === 'unknown' ||
    sources.some((source) => source.state === 'unknown') ||
    !health ||
    !timestamp(health.checkedAt)
      ? 'unknown'
      : policyComplete &&
          hostHealthy &&
          sources.every((source) => source.state === 'ok') &&
          historyAudit.state === 'ok'
        ? 'ok'
        : 'incomplete';
  return {
    version: 1,
    policy: 'asa-connected-v1',
    state,
    requiredSourceIds,
    excludedSourceIds,
    sources,
    native: { state: 'unknown', reason: 'native_writer_unavailable' },
    historyAudit,
    limitations,
  };
}

export function combineRequiredCoverage(
  host: RequiredCoverage | undefined,
  native: NativeCoverage,
): RequiredCoverage {
  const coverage = host ?? unknownRequiredCoverage('host_catalog_unavailable');
  return {
    ...coverage,
    native,
    state:
      coverage.state === 'unknown' || native.state === 'unknown'
        ? 'unknown'
        : coverage.state === 'ok' && native.state === 'ok'
          ? 'ok'
          : 'incomplete',
  };
}
