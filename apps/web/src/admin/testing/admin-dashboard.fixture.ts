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
    activeAccounts:
      index < 21 ? amount + (empty ? 0 : index % 5) : Math.max(0, amount - (index % 3)),
    successfulLogins: amount,
    failedLogins: 0,
    successfulRegistrations: amount,
    authenticatedSessions: amount,
    rejectedAuthAttempts: 0,
    newStudents: index === 10 ? amount * 6 : index === 21 ? amount * 4 : 0,
    activeStudents:
      index < 21 ? amount * 2 + (empty ? 0 : index % 7) : Math.max(0, amount * 2 - (index % 3)),
    studentLogins: index < 21 ? amount * 2 : amount,
  }));
  const modules = timeline.flatMap((point, index) =>
    (['electronics', 'robotics', 'three-d', 'blocks', 'chess', 'checkers'] as const).map(
      (moduleKey, moduleIndex) => ({
        at: point.at,
        moduleKey,
        activePeople: amount,
        launches: empty ? 0 : ((moduleIndex + index + 1) % 9) + (index % 4),
        activeSeconds: empty ? 0 : 60 * (((moduleIndex + index) % 6) + (index % 3)),
      }),
    ),
  );
  return {
    generatedAt: '2026-10-25T23:10:00Z',
    analyticsStartedAt: '2026-10-25T00:00:00Z',
    from: timeline[0]!.at,
    to: '2026-10-25T23:10:00Z',
    bucketSeconds: 3600,
    range,
    todayMsk: {
      from: '2026-10-25T21:00:00Z',
      to: '2026-10-25T23:10:00Z',
      activeAccounts: amount,
      activeStudents: amount * 2,
      studentLogins: amount * 3,
      newStudents: amount * 4,
    },
    summary: {
      newAccounts: amount,
      activeAccounts: amount,
      successfulLogins: amount,
      failedLogins: 0,
      successfulRegistrations: amount,
      authenticatedSessions: amount,
      rejectedAuthAttempts: 0,
      newStudents: timeline.reduce((sum, point) => sum + point.newStudents, 0),
      activeStudents: amount,
      studentLogins: amount * 2,
      distinctIpAddresses: amount,
      accountsWithMultipleIps: 0,
      localNetworkAccounts: 0,
      unclassifiedNetworkEvents: 0,
    },
    timeline,
    overview: {
      points: timeline.map((point, index) => ({
        ...point,
        from: point.at,
        to: timeline[index + 1]?.at ?? '2026-10-25T23:10:00Z',
        accountSeconds: empty ? null : 120,
        studentSeconds: empty ? null : 150,
        accountLogins: amount,
      })),
      recentAccounts: amount,
      recentStudents: amount,
      network: {
        addresses: 0,
        resolvedEvents: 0,
        unresolvedEvents: amount * 2,
        peopleWithMultipleAddresses: 0,
      },
      modules,
      actions: [],
      loginMethods: timeline.map((point) => ({
        at: point.at,
        method: 'telegram',
        successfulLogins: amount,
      })),
    },
    modules,
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
