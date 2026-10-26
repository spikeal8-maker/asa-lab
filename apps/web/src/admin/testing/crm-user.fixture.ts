import type { CrmProfile, CrmDashboard } from '../crm-user-api';
export function crmDashboardFixture(kind: 'account' | 'student' = 'account'): CrmDashboard {
  return {
    generatedAt: '2026-10-25T12:00:00Z',
    period: { days: 30, timeZone: 'UTC', from: '2026-09-26T00:00:00Z', to: '2026-10-26T00:00:00Z' },
    lastSeenAt: '2026-10-25T12:00:00Z',
    lastActionAt: '2026-10-25T11:59:00Z',
    totals: {
      projects: 12,
      publications: 3,
      aiRequests: 15,
      aiErrors: 2,
      events: 30,
      inputTokens: '1200',
      outputTokens: '200',
    },
    activity: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 26 + i)).toISOString().slice(0, 10),
      events: i % 3,
      aiRequests: i % 2,
    })),
    latestActions: [
      { occurredAt: '2026-10-25T11:59:00Z', eventType: 'project.saved', module: 'electronics' },
    ],
    rating:
      kind === 'student'
        ? { kind: 'classroom', value: 78, rank: 2, periodDays: 30, label: 'Учебный рейтинг класса' }
        : {
            kind: 'not_configured',
            value: null,
            rank: null,
            periodDays: null,
            label: 'Общий рейтинг ещё не настроен',
          },
    coverage: {
      activityFrom: '2026-09-26T00:00:00Z',
      limited: true,
      aiDetailedRequests: 15,
      tokenRequests: 10,
    },
  };
}
export const CRM_ID = '20000000-0000-4000-8000-000000000002';
export function crmProfileFixture(kind: 'account' | 'student' = 'account'): CrmProfile {
  return {
    kind,
    id: CRM_ID,
    name:
      kind === 'account'
        ? 'Полное имя пользователя цифровой образовательной лаборатории'
        : 'Полное имя ученика цифровой образовательной лаборатории',
    bio: 'Описание пользователя и его интересов',
    country: 'RU',
    birthDate: kind === 'account' ? '1990-01-01' : '2015-01-01',
    age: kind === 'account' ? 36 : 11,
    email: kind === 'account' ? 'profile@example.test' : null,
    status: 'active',
    registeredAt: '2026-10-24T12:00:00Z',
    classId: kind === 'student' ? '10000000-0000-4000-8000-000000000002' : null,
    classTitle: kind === 'student' ? 'Длинное название учебного класса цифровой лаборатории' : null,
    version: 'a'.repeat(64),
    canEdit: true,
    canManageCapabilities: kind === 'account',
    linkedIdentities: [],
    capabilities: kind === 'account' ? [{ capability: 'educator', state: 'verified' }] : [],
    memberships: [],
    teachingClasses: [],
  };
}
