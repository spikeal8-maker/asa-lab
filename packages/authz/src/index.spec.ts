import { describe, expect, it } from 'vitest';
import { authorizeAdmin, resolveAdminScopeGrants, type AdminSubject } from './index.js';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000002';

function subject(overrides: Partial<AdminSubject> = {}): AdminSubject {
  return {
    principalId: 'principal',
    accountId: 'account',
    capabilities: [],
    workspaces: [],
    ...overrides,
  };
}

describe('administrative policy engine', () => {
  it('does not turn educator or personal workspace ownership into admin access', () => {
    const grants = resolveAdminScopeGrants(
      subject({
        capabilities: [{ capability: 'educator', state: 'verified' }],
        workspaces: [
          {
            workspaceId: ORGANIZATION_ID,
            kind: 'personal',
            title: 'Личное пространство',
            role: 'owner',
          },
        ],
      }),
    );

    expect(grants).toEqual([]);
  });

  it('requires a verified platform-admin capability', () => {
    const provisional = subject({
      capabilities: [{ capability: 'platform_admin', state: 'provisional' }],
    });
    const verified = subject({
      capabilities: [{ capability: 'platform_admin', state: 'verified' }],
    });

    expect(resolveAdminScopeGrants(provisional)).toEqual([]);
    expect(resolveAdminScopeGrants(verified)[0]).toMatchObject({
      kind: 'platform',
      role: 'platform_admin',
    });
  });

  it('keeps an organization administrator inside their workspace', () => {
    const admin = subject({
      workspaces: [
        {
          workspaceId: ORGANIZATION_ID,
          kind: 'organization',
          title: 'Школа',
          role: 'school_admin',
        },
      ],
    });

    expect(
      authorizeAdmin(admin, {
        permission: 'administration.audit.read',
        scope: { kind: 'organization', id: ORGANIZATION_ID },
      }).allowed,
    ).toBe(true);
    expect(
      authorizeAdmin(admin, {
        permission: 'administration.audit.read',
        scope: { kind: 'organization', id: OTHER_ORGANIZATION_ID },
      }),
    ).toEqual({ allowed: false, reason: 'scope_not_granted' });
    expect(
      authorizeAdmin(admin, {
        permission: 'administration.operations.read',
        scope: { kind: 'platform', id: null },
      }),
    ).toEqual({ allowed: false, reason: 'scope_not_granted' });
    expect(
      authorizeAdmin(admin, {
        permission: 'administration.accounts.manage',
        scope: { kind: 'organization', id: ORGANIZATION_ID },
      }),
    ).toEqual({ allowed: false, reason: 'permission_not_granted' });
  });

  it('gives moderator and billing roles only their own surfaces', () => {
    const moderator = subject({
      workspaces: [
        {
          workspaceId: ORGANIZATION_ID,
          kind: 'organization',
          title: 'Школа',
          role: 'moderator',
        },
      ],
    });
    const billing = subject({
      workspaces: [
        {
          workspaceId: ORGANIZATION_ID,
          kind: 'organization',
          title: 'Школа',
          role: 'billing_admin',
        },
      ],
    });

    expect(
      authorizeAdmin(moderator, {
        permission: 'administration.moderation.read',
        scope: { kind: 'organization', id: ORGANIZATION_ID },
      }).allowed,
    ).toBe(true);
    expect(
      authorizeAdmin(moderator, {
        permission: 'administration.billing.read',
        scope: { kind: 'organization', id: ORGANIZATION_ID },
      }),
    ).toEqual({ allowed: false, reason: 'permission_not_granted' });
    expect(
      authorizeAdmin(billing, {
        permission: 'administration.billing.read',
        scope: { kind: 'organization', id: ORGANIZATION_ID },
      }).allowed,
    ).toBe(true);
  });

  it('lets a verified platform admin authorize a narrower organization request', () => {
    const admin = subject({
      capabilities: [{ capability: 'platform_admin', state: 'verified' }],
    });

    const decision = authorizeAdmin(admin, {
      permission: 'administration.audit.read',
      scope: { kind: 'organization', id: ORGANIZATION_ID },
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.grant.kind).toBe('platform');
    expect(
      authorizeAdmin(admin, {
        permission: 'administration.accounts.manage',
        scope: { kind: 'platform', id: null },
      }).allowed,
    ).toBe(true);
  });
});
