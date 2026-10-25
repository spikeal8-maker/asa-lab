import type { CrmProfile } from '../crm-user-api';
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
