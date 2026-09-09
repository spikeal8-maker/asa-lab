import { describe, expect, it } from 'vitest';
import { effectiveAccountActions } from '../application/effective-actions.js';
import type { CapabilityRef, WorkspaceRef } from '../application/account.ports.js';

const personal: WorkspaceRef = {
  workspaceId: 'personal',
  tenantId: 'own',
  kind: 'personal',
  title: 'Personal',
  role: 'owner',
};
const school: WorkspaceRef = {
  workspaceId: 'school',
  tenantId: 'school',
  kind: 'organization',
  title: 'School',
  role: 'student',
};
const grant = (capability: string, state = 'verified'): CapabilityRef => ({ capability, state });
const resolve = (grants: CapabilityRef[], workspace = personal, memberships = [workspace]) =>
  effectiveAccountActions(
    { workspaceId: workspace.workspaceId, workspaceKind: workspace.kind },
    grants,
    memberships,
  );

describe('Result A: server-effective account actions', () => {
  it('ordinary creator owns projects, but has no authoring or class actions', () => {
    const actions = resolve([grant('creator')]);
    expect(actions).toContain('project.create');
    expect(actions.some((action) => /^(class|content)\./.test(action))).toBe(false);
  });
  it('author-only has own content, not delivery, classes, or learner records', () => {
    const actions = resolve([grant('content_author')]);
    expect(actions).toContain('content.create.own');
    expect(actions).not.toContain('content.deliver');
    expect(actions).not.toContain('class.read.staff');
  });
  it('independent teacher keeps personal projects and own learning', () => {
    expect(resolve([grant('educator')])).toEqual(
      expect.arrayContaining(['class.create', 'project.create', 'learning.own.read']),
    );
  });
  it('mixed educator and learner does not export teaching rights into a learner workspace', () => {
    const actions = resolve([grant('educator')], school, [personal, school]);
    expect(actions).toContain('learning.own.read');
    expect(actions).not.toContain('class.read.staff');
    expect(actions).not.toContain('content.create.own');
  });
  it.each(['revoked', 'suspended', 'pending', 'unknown'])(
    'inactive grant %s has no staff access',
    (state) => {
      expect(resolve([grant('educator', state), grant('content_author', state)])).not.toContain(
        'class.create',
      );
      expect(resolve([grant('content_author', state)])).not.toContain('content.create.own');
    },
  );
  it('unknown workspace and forged membership kind are fail-closed', () => {
    expect(resolve([grant('educator')], personal, [])).toEqual([]);
    expect(resolve([grant('educator')], personal, [{ ...personal, kind: 'organization' }])).toEqual(
      [],
    );
  });
});
