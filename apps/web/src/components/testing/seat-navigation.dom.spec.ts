// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortalHeader } from '../PortalHeader';
import { studentSessionPayload } from '../../creator-portal/student-session';

vi.mock('../PresentationPreferences', () => ({
  usePresentation: () => ({ draft: { sidebar: 'expanded' }, loaded: true, busy: false }),
}));
vi.mock('../../creator-portal/QuickProjectCreation', () => ({ QuickCreateMenu: () => null }));

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('Seat header navigation', () => {
  it('renders native links, closes the mobile drawer and restores focus without staff access', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const seat = {
      authenticated: true as const,
      student: { seatId: 'own-seat', displayName: 'Ученик', safeMode: true, avatarKey: null },
      classroom: { id: 'own-class', title: 'Класс', teacherDisplayName: 'Учитель' },
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    const session = studentSessionPayload(seat);
    const before = structuredClone(session);
    expect(session.capabilities).toEqual([]);
    expect(session.navigation).toEqual({ classes: false, classroomManagement: false });
    const navigate = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        createElement(PortalHeader, {
          session,
          canTeach: false,
          seatLearner: true,
          active: 'projects',
          onNavigate: navigate,
          onSessionChanged: vi.fn(),
          onLoggedOut: vi.fn(),
        }),
      );
    });
    const sidebar = container.querySelector<HTMLElement>('#portal-sidebar')!;
    const links = [...sidebar.querySelectorAll<HTMLAnchorElement>('a')];
    const projects = links.find((link) => link.getAttribute('aria-label') === 'Мои проекты')!;
    const games = links.find((link) => link.getAttribute('aria-label') === 'Игры')!;
    expect(projects.getAttribute('href')).toBe('/#/projects');
    expect(projects.getAttribute('aria-current')).toBe('page');
    expect(games.getAttribute('href')).toBe('/#/games');
    // Main keeps AI discoverable in the public header/drawer groups; Seat
    // access remains controlled by App, with no capability granted here.
    const headerAi = container.querySelector<HTMLAnchorElement>(
      '.portal-global-nav > a[aria-label="ИИ"]',
    )!;
    const drawerAi = sidebar.querySelector<HTMLAnchorElement>(
      '.portal-mobile-public > a[href="/#/ai"]',
    )!;
    expect(headerAi.tagName).toBe('A');
    expect(headerAi.getAttribute('href')).toBe('/#/ai');
    expect(drawerAi.tagName).toBe('A');
    expect(drawerAi.getAttribute('href')).toBe('/#/ai');
    expect(drawerAi.querySelector('.portal-nav-label')?.textContent).toBe('ИИ');
    expect(sidebar.querySelector('.portal-nav > a[href="/#/ai"]')).toBeNull();
    expect(links.some((link) => /Классы|Курсы и задания/.test(link.textContent ?? ''))).toBe(false);
    expect(container.querySelector('[data-admin-navigation]')).toBeNull();
    const menu = container.querySelector<HTMLButtonElement>('[aria-label="Открыть меню"]')!;
    await act(async () => menu.click());
    expect(sidebar.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Закрыть меню');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(sidebar.hasAttribute('aria-modal')).toBe(false);
    expect(document.activeElement).toBe(menu);
    await act(async () => menu.click());
    await act(async () => games.click());
    expect(navigate).toHaveBeenLastCalledWith('games');
    expect(sidebar.hasAttribute('aria-modal')).toBe(false);
    expect(document.activeElement).toBe(menu);
    await act(async () => projects.click());
    expect(navigate).toHaveBeenLastCalledWith('projects');
    expect(session).toEqual(before);
    expect(seat.student.safeMode).toBe(true);
  });
});
