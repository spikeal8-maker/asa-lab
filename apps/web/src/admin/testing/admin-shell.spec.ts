import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '../../api';
import { PortalHeader } from '../../components/PortalHeader';

const SESSION: SessionPayload = {
  authenticated: true,
  user: {
    id: '10000000-0000-4000-8000-000000000001',
    displayName: 'Администратор',
    email: 'admin@example.test',
  },
  account: {
    id: '10000000-0000-4000-8000-000000000001',
    displayName: 'Администратор',
    email: 'admin@example.test',
  },
  capabilities: [],
  workspaces: [
    {
      workspaceId: '20000000-0000-4000-8000-000000000001',
      kind: 'organization',
      title: 'Школа № 1',
      role: 'school_admin',
    },
  ],
  activeWorkspace: {
    workspaceId: '20000000-0000-4000-8000-000000000001',
    kind: 'organization',
  },
  navigation: { classes: true, classroomManagement: true },
  timeZone: 'Europe/Moscow',
};

beforeEach(() => {
  vi.stubGlobal('window', {
    localStorage: { getItem: vi.fn(() => null) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function render(admin: boolean): string {
  return renderToStaticMarkup(
    createElement(PortalHeader, {
      session: SESSION,
      active: 'home',
      canTeach: true,
      onNavigate: vi.fn(),
      onSessionChanged: vi.fn(),
      onLoggedOut: vi.fn(),
      onCreate: vi.fn(),
      ...(admin ? { adminNavigation: { active: false, onNavigate: vi.fn() } } : {}),
    }),
  );
}

describe('administrative portal entry', () => {
  it('is absent until the server-confirmed navigation contract is supplied', () => {
    expect(render(false)).not.toContain('data-admin-navigation="true"');
    expect(render(true)).toContain('data-admin-navigation="true"');
  });
});
