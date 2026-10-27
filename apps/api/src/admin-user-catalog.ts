import type { AdminAccountView } from './admin-control-plane.service.js';

export const CATALOG_KINDS = ['all', 'accounts', 'students'] as const;
export const CATALOG_STATUSES = ['all', 'active', 'inactive'] as const;
export const CATALOG_SORTS = ['name', 'last_activity', 'activity', 'created'] as const;
export interface AdminCatalogQuery {
  kind: (typeof CATALOG_KINDS)[number];
  status: (typeof CATALOG_STATUSES)[number];
  sort: (typeof CATALOG_SORTS)[number];
  direction: 'asc' | 'desc';
  limit: number;
  cursor: Record<string, unknown> | null;
  filters: CatalogFilters;
}
export interface AdminCatalogUser {
  kind: 'account' | 'student';
  id: string;
  actorKey: string;
  principalId: string | null;
  displayName: string;
  login: string | null;
  email: string | null;
  status: string;
  normalizedStatus: 'active' | 'inactive';
  createdAt: string;
  lastSeenAt: string | null;
  lastActivityAt: string | null;
  recentActivityCount: number;
  lastIpAddress: string | null;
  lastNetworkKind: string | null;
  lastDevice: string | null;
  browser: string | null;
  operatingSystem: string | null;
  deviceCategory: string | null;
  classId: string | null;
  classTitle: string | null;
  classStatus: string | null;
  birthDate?: string | null;
  age?: number | null;
  country?: string | null;
  roles?: readonly string[];
  classIds?: readonly string[];
  linkedRecordCount?: number | null;
  emailVerificationState?: string | null;
  firstObservedReferrer?: string | null;
  firstObservedAt?: string | null;
  acquisitionLatest?: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    observedAt: string;
  } | null;
  aiRequests?: number | null;
  aiLegacyRequests?: number | null;
  aiTokenCovered?: number | null;
  aiInputTokens?: string | null;
  aiOutputTokens?: string | null;
  aiPeriodDays?: number;
  account: AdminAccountView | null;
}
export interface AdminCatalogPage {
  items: AdminCatalogUser[];
  asOf: string;
  studentCoverage: {
    state: 'complete' | 'unavailable';
    reason?: 'organization_class_mapping_unavailable';
  };
  next: string | null;
  matchedCount?: number;
  analytics?: CatalogAnalytics;
}
function invalid(): never {
  throw Object.assign(new Error('ADMIN_CATALOG_QUERY_INVALID'), { code: '22023' });
}
function choice<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  return allowed.includes(value as T) ? (value as T) : invalid();
}
export interface CatalogAnalytics {
  accounts: number;
  students: number;
  linkedRecords: number | null;
  ageUnknown: number;
  emailAbsent: number;
  sourceUnknown: number;
  activeObserved: number;
  aiCoverage?: 'all_authorized' | 'students_only_accounts_unavailable';
  aiLegacyRequests?: number | null;
  aiRequests: number | null;
  aiTokenCovered: number | null;
  periodDays: number;
  registrationSource: 'not_stored';
  geo: 'not_stored';
  roles: Record<string, number>;
  referrers: Record<string, number>;
  aiInputTokens?: string | null;
  aiOutputTokens?: string | null;
  activityEvents?: number;
  registrationMethods?: Record<string, number>;
  loginMethods?: Record<string, number>;
  tools?: Record<string, number>;
  devices?: Record<string, number>;
  ageGroups?: Record<string, number>;
  acquisition?: {
    retentionDays: 90;
    status: 'collecting_current_document';
    observedRecords: number;
    unknownRecords: number;
    observations: number;
    sources: Record<string, number>;
    mediums: Record<string, number>;
    campaigns: Record<string, number>;
  };
  daily?: { date: string; registrations: number; events: number }[];
}
export type CatalogFilters = Partial<
  Record<
    | 'role'
    | 'classId'
    | 'organizationId'
    | 'age'
    | 'ageMin'
    | 'ageMax'
    | 'email'
    | 'activity'
    | 'registeredAfter'
    | 'registeredBefore'
    | 'source'
    | 'days',
    string
  >
>;
export function parseCatalogFilters(raw: Record<string, unknown>): CatalogFilters {
  const result: CatalogFilters = {};
  const enums: Record<string, readonly string[]> = {
    role: [
      'all',
      'learner',
      'creator',
      'educator',
      'registered_student',
      'guardian',
      'platform_admin',
      'owner',
      'school_admin',
      'member',
    ],
    age: ['all', 'known', 'unknown'],
    email: ['all', 'present', 'absent', 'verified', 'unverified'],
    activity: ['all', 'observed', 'unknown'],
    source: ['all', 'observed', 'unknown'],
    days: ['7', '30', '90'],
  };
  for (const key of [
    'role',
    'classId',
    'organizationId',
    'age',
    'ageMin',
    'ageMax',
    'email',
    'activity',
    'registeredAfter',
    'registeredBefore',
    'source',
    'days',
  ] as const) {
    const value = raw[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') invalid();
    if (enums[key] && !enums[key]!.includes(value)) invalid();
    if (key === 'classId' || key === 'organizationId') {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid();
    }
    if (key === 'ageMin' || key === 'ageMax') {
      if (!/^(0|[1-9][0-9]{0,2})$/.test(value) || Number(value) > 120) invalid();
    }
    if (key === 'registeredAfter' || key === 'registeredBefore') {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      )
        invalid();
    }
    result[key] = value;
  }
  if (
    Number(result.ageMin ?? 0) > Number(result.ageMax ?? 120) ||
    (result.age === 'unknown' && (result.ageMin !== undefined || result.ageMax !== undefined))
  )
    invalid();
  if (
    result.registeredAfter &&
    result.registeredBefore &&
    result.registeredAfter > result.registeredBefore
  )
    invalid();
  return result;
}
export function catalogCsv(items: readonly AdminCatalogUser[]): string {
  const columns: [string, string][] = [
    ['kind', 'Тип записи'],
    ['id', 'ID'],
    ['displayName', 'Имя'],
    ['login', 'Логин'],
    ['email', 'Почта'],
    ['emailVerificationState', 'Подтверждение почты'],
    ['status', 'Состояние'],
    ['birthDate', 'Дата рождения'],
    ['age', 'Возраст'],
    ['country', 'Страна профиля'],
    ['classTitle', 'Класс'],
    ['classIds', 'ID классов'],
    ['roles', 'Возможности'],
    ['linkedRecordCount', 'Связанные записи'],
    ['createdAt', 'Создано'],
    ['lastSeenAt', 'Последний вход/наблюдение'],
    ['lastActivityAt', 'Последняя активность'],
    ['recentActivityCount', 'События за 30 дней'],
    ['lastIpAddress', 'Последний наблюдавшийся IP'],
    ['browser', 'Браузер'],
    ['operatingSystem', 'ОС'],
    ['deviceCategory', 'Устройство'],
    ['firstObservedReferrer', 'Первый наблюдавшийся реферер (не источник регистрации)'],
    ['firstObservedAt', 'Первое наблюдение визита'],
    ['acquisitionSource', 'Источник UTM: последнее заявление браузера за 90 дней'],
    ['acquisitionMedium', 'Канал UTM: последнее заявление браузера за 90 дней'],
    ['acquisitionCampaign', 'Кампания UTM: последнее заявление браузера за 90 дней'],
    ['acquisitionObservedAt', 'Время наблюдения UTM (не источник регистрации)'],
    ['aiPeriodDays', 'Период ИИ, дней'],
    ['aiRequests', 'Запросы ИИ за период'],
    ['aiLegacyRequests', 'Обращения из прежнего журнала без токенов'],
    ['aiTokenCovered', 'Запросы с известными токенами'],
    ['aiInputTokens', 'Входные токены (известная часть)'],
    ['aiOutputTokens', 'Выходные токены (известная часть)'],
  ];
  const labels: Record<string, string> = {
    account: 'Аккаунт',
    student: 'Ученическое место',
    active: 'Действует',
    issued: 'Выдано',
    suspended: 'Приостановлено',
    removed: 'Удалено',
    archived: 'В архиве',
    closed: 'Закрыто',
    deleted: 'Удалено',
    verified: 'Подтверждено',
    pending: 'Ожидает подтверждения',
    unverified: 'Не подтверждено',
    learner: 'Ученическое место',
    creator: 'Автор',
    educator: 'Преподаватель',
    registered_student: 'Учащийся (аккаунт)',
    guardian: 'Представитель',
    platform_admin: 'Администратор платформы',
    owner: 'Владелец организации',
    school_admin: 'Администратор организации',
    member: 'Участник организации',
    desktop: 'Компьютер',
    mobile: 'Телефон',
    tablet: 'Планшет',
  };
  const display = (item: AdminCatalogUser, key: string) => {
    const acquisitionKeys: Record<string, 'source' | 'medium' | 'campaign' | 'observedAt'> = {
      acquisitionSource: 'source',
      acquisitionMedium: 'medium',
      acquisitionCampaign: 'campaign',
      acquisitionObservedAt: 'observedAt',
    };
    if (acquisitionKeys[key]) return item.acquisitionLatest?.[acquisitionKeys[key]];
    const value = (item as unknown as Record<string, unknown>)[key];
    if (key === 'roles' && Array.isArray(value)) return value.map((v) => labels[String(v)] ?? v);
    if (
      ['kind', 'status', 'emailVerificationState', 'deviceCategory'].includes(key) &&
      typeof value === 'string'
    )
      return labels[value] ?? value;
    return value;
  };
  const cell = (value: unknown) => {
    let text =
      value === null || value === undefined
        ? 'Неизвестно'
        : Array.isArray(value)
          ? value.join(', ')
          : String(value);
    if (/^[\s\p{Cc}\p{Cf}]*[=+@-]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    '\uFEFF' +
    [
      columns.map(([, title]) => cell(title)).join(';'),
      ...items.map((item) => columns.map(([key]) => cell(display(item, key))).join(';')),
    ].join('\r\n')
  );
}
export function parseCatalogQuery(
  raw: Partial<
    Record<
      | 'kind'
      | 'status'
      | 'sort'
      | 'direction'
      | 'limit'
      | 'cursor'
      | 'search'
      | 'scopeKind'
      | 'scopeId'
      | keyof CatalogFilters,
      string | undefined
    >
  >,
): AdminCatalogQuery {
  for (const value of Object.values(raw))
    if (value !== undefined && typeof value !== 'string') invalid();
  const limit =
    raw.limit === undefined ? 50 : /^[0-9]{1,3}$/.test(raw.limit) ? Number(raw.limit) : invalid();
  if (limit < 1 || limit > 100) invalid();
  let cursor: Record<string, unknown> | null = null;
  if (raw.cursor !== undefined) {
    if (raw.cursor.length > 4096 || !raw.cursor.length || !/^[A-Za-z0-9_-]+$/.test(raw.cursor))
      invalid();
    try {
      const decoded = Buffer.from(raw.cursor, 'base64url');
      if (decoded.toString('base64url') !== raw.cursor) invalid();
      const value: unknown = JSON.parse(decoded.toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
      cursor = value as Record<string, unknown>;
    } catch {
      invalid();
    }
  }
  return {
    kind: choice(raw.kind, CATALOG_KINDS, 'all'),
    status: choice(raw.status, CATALOG_STATUSES, 'all'),
    sort: choice(raw.sort, CATALOG_SORTS, 'last_activity'),
    direction: choice(raw.direction, ['asc', 'desc'], 'desc'),
    limit,
    cursor,
    filters: parseCatalogFilters(raw),
  };
}
