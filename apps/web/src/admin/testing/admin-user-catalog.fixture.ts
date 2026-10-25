import type { AdminCatalogUser, AdminCatalogPage } from '../admin-api';
export function catalogUserFixture(
  kind: 'account' | 'student',
  id = '20000000-0000-4000-8000-000000000001',
  displayName = 'Длинное имя пользователя каталога',
): AdminCatalogUser {
  const common = {
    kind,
    id,
    actorKey: `${kind}:${id}`,
    principalId:
      kind === 'student'
        ? '30000000-0000-4000-8000-000000000002'
        : '30000000-0000-4000-8000-000000000001',
    displayName,
    login: kind === 'student' ? null : 'account_01',
    email: kind === 'student' ? null : 'account@example.test',
    status: kind === 'student' ? 'issued' : 'active',
    normalizedStatus: 'active' as const,
    createdAt: '2026-10-24T12:00:00.000001Z',
    lastSeenAt: '2026-10-25T12:00:00Z',
    lastActivityAt: '2026-10-25T11:00:00Z',
    recentActivityCount: 12,
    lastIpAddress: '203.0.113.44',
    lastNetworkKind: 'public' as const,
    lastDevice: 'Chrome · Windows',
    browser: 'Chrome',
    operatingSystem: 'Windows',
    deviceCategory: 'desktop',
    classId: kind === 'student' ? '40000000-0000-4000-8000-000000000001' : null,
    classTitle:
      kind === 'student' ? 'Очень длинное название учебного класса цифровой лаборатории' : null,
    classStatus: kind === 'student' ? 'active' : null,
  };
  return {
    ...common,
    account:
      kind === 'student'
        ? null
        : {
            accountId: id,
            principalId: common.principalId,
            email: common.email!,
            displayName,
            username: common.login!,
            status: 'active',
            emailVerificationState: 'verified',
            createdAt: common.createdAt,
            organizationRole: null,
            membershipState: null,
            activeSessionCount: 1,
            lastSeenAt: common.lastSeenAt,
            hasEverSignedIn: true,
            isPlatformAdmin: false,
            lastIpAddress: common.lastIpAddress,
            lastNetworkKind: 'public',
            lastDevice: common.lastDevice,
            recentActivityCount: 12,
          },
  };
}
export function catalogPageFixture(
  items: readonly AdminCatalogUser[] = [],
  next: string | null = null,
  organization = false,
): AdminCatalogPage {
  return {
    items,
    next,
    asOf: '2026-10-25T12:00:00.123456Z',
    studentCoverage: organization
      ? { state: 'unavailable', reason: 'organization_class_mapping_unavailable' }
      : { state: 'complete' },
  };
}
