import type { AdminDashboardRange, AdminProductDashboard } from '../admin-api';

export function adminDashboardFixture(
  range: AdminDashboardRange = '24h',
  marker = 8,
  empty = false,
): AdminProductDashboard {
  const amount = empty ? 0 : marker;
  const timeline = Array.from({ length: 24 }, (_, index) => ({
    at: new Date(Date.UTC(2026, 9, 25, index)).toISOString(),
    newAccounts: amount,
    activeAccounts: amount,
    successfulLogins: amount,
    failedLogins: 0,
    successfulRegistrations: amount,
    authenticatedSessions: amount,
    rejectedAuthAttempts: 0,
    newStudents: amount,
    activeStudents: amount,
  }));
  return {
    generatedAt: '2026-10-25T23:10:00Z',
    analyticsStartedAt: '2026-10-25T00:00:00Z',
    from: timeline[0]!.at,
    to: timeline[23]!.at,
    bucketSeconds: 3600,
    range,
    summary: {
      newAccounts: amount,
      activeAccounts: amount,
      successfulLogins: amount,
      failedLogins: 0,
      successfulRegistrations: amount,
      authenticatedSessions: amount,
      rejectedAuthAttempts: 0,
      newStudents: amount,
      activeStudents: amount,
      distinctIpAddresses: amount,
      accountsWithMultipleIps: 0,
      localNetworkAccounts: 0,
      unclassifiedNetworkEvents: 0,
    },
    timeline,
    modules: timeline.flatMap((point, index) =>
      (['electronics', 'three-d', 'blocks', 'chess', 'checkers'] as const).map(
        (moduleKey, moduleIndex) => ({
          at: point.at,
          moduleKey,
          activePeople: amount,
          launches: empty ? 0 : moduleIndex + index + 1,
          activeSeconds: empty ? 0 : 60 * (moduleIndex + index + 1),
        }),
      ),
    ),
    loginMethods: timeline.map((point) => ({
      at: point.at,
      method: 'password',
      successfulLogins: amount,
    })),
    actions: timeline.map((point) => ({
      at: point.at,
      classesCreated: amount,
      projectsCreated: amount,
      maxLinked: 0,
      passwordRecoveryAvailable: false,
    })),
    max: {
      configured: false,
      featureEnabled: false,
      tokenConfigured: false,
      botUsername: null,
      launchUrl: null,
      miniAppUrl: null,
      encryptionReady: true,
      tokenFingerprint: null,
      verifiedBotId: null,
      verifiedBotName: null,
      tokenVerifiedAt: null,
      configurationVersion: 1,
      updatedAt: null,
      linkedAccounts: 0,
      promptDueAccounts: 0,
    },
  };
}
