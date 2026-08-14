import type { Project } from '../api';

export type CreatorPortalSection =
  'home' | 'projects' | 'learning' | 'collections' | 'challenges' | 'classes' | 'help' | 'account';

export type CreatorPortalView =
  | { kind: 'home' }
  | { kind: 'my-projects' }
  | { kind: 'learning' }
  | { kind: 'collections' }
  | { kind: 'challenges' }
  | { kind: 'classrooms' }
  | { kind: 'help' }
  | { kind: 'account' }
  | { kind: 'classroom-projects'; classroomId: string; classroomTitle: string }
  | {
      kind: 'editor';
      projectId: string;
      returnTo:
        | { kind: 'home' }
        | { kind: 'my-projects' }
        | { kind: 'classroom-projects'; classroomId: string; classroomTitle: string };
    };

export interface PortalNavigationItem {
  readonly section: Exclude<CreatorPortalSection, 'account'>;
  readonly label: string;
}

export type CreatorHomeState = 'loading' | 'error' | 'empty' | 'ready';

const PORTAL_ROUTES: ReadonlyArray<{
  readonly path: string;
  readonly view: Exclude<CreatorPortalView, { kind: 'editor' } | { kind: 'classroom-projects' }>;
}> = [
  { path: '/home', view: { kind: 'home' } },
  { path: '/projects', view: { kind: 'my-projects' } },
  { path: '/learning', view: { kind: 'learning' } },
  { path: '/collections', view: { kind: 'collections' } },
  { path: '/challenges', view: { kind: 'challenges' } },
  { path: '/classrooms', view: { kind: 'classrooms' } },
  { path: '/help', view: { kind: 'help' } },
  { path: '/account', view: { kind: 'account' } },
];

function decodeRouteParameter(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function portalNavigation(canTeach: boolean): readonly PortalNavigationItem[] {
  // Kept in the public signature for callers that also use the capability for
  // management actions. The Classes destination itself is available to every
  // signed-in account.
  void canTeach;
  return [
    { section: 'home', label: 'Главная' },
    { section: 'classes', label: 'Классы' },
    { section: 'projects', label: 'Проекты' },
    { section: 'collections', label: 'Коллекции' },
    { section: 'learning', label: 'Учебные пособия' },
    { section: 'challenges', label: 'Задачи' },
    { section: 'help', label: 'Справочный центр' },
  ];
}

export function canUseClasses(
  navigation: { readonly classes: boolean },
  activeWorkspaceKind: string,
): boolean {
  return navigation.classes && activeWorkspaceKind === 'organization';
}

export function sectionForView(view: CreatorPortalView, canTeach: boolean): CreatorPortalSection {
  void canTeach;
  if (view.kind === 'account') return 'account';
  if (view.kind === 'home') return 'home';
  if (view.kind === 'learning') return 'learning';
  if (view.kind === 'collections') return 'collections';
  if (view.kind === 'challenges') return 'challenges';
  if (view.kind === 'help') return 'help';
  if (view.kind === 'classrooms' || view.kind === 'classroom-projects') {
    return 'classes';
  }
  return 'projects';
}

export function creatorViewToHash(view: CreatorPortalView): string {
  const simpleRoute = PORTAL_ROUTES.find((route) => route.view.kind === view.kind);
  if (simpleRoute) return `#${simpleRoute.path}`;
  if (view.kind === 'classroom-projects') {
    return `#/classrooms/${view.classroomId}/projects?title=${encodeURIComponent(view.classroomTitle)}`;
  }
  if (view.kind !== 'editor') return '#/home';
  if (view.returnTo.kind === 'classroom-projects') {
    return `#/classrooms/${view.returnTo.classroomId}/projects/${view.projectId}?title=${encodeURIComponent(view.returnTo.classroomTitle)}`;
  }
  const returnPath = view.returnTo.kind === 'home' ? 'home' : 'projects';
  return `#/${returnPath}/${view.projectId}`;
}

export function creatorViewFromHash(hash: string): CreatorPortalView {
  const raw = hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  const title = new URLSearchParams(query ?? '').get('title') ?? 'Класс';
  const classEditor = /^\/classrooms\/([^/]+)\/projects\/([^/]+)$/.exec(path ?? '');
  if (classEditor) {
    return {
      kind: 'editor',
      projectId: classEditor[2] as string,
      returnTo: {
        kind: 'classroom-projects',
        classroomId: classEditor[1] as string,
        classroomTitle: title,
      },
    };
  }
  const classProjects = /^\/classrooms\/([^/]+)\/projects$/.exec(path ?? '');
  if (classProjects) {
    return {
      kind: 'classroom-projects',
      classroomId: classProjects[1] as string,
      classroomTitle: title,
    };
  }
  const independentThreeDEditor = /^\/3d\/([^/]+)$/.exec(path ?? '');
  if (independentThreeDEditor) {
    const projectId = decodeRouteParameter(independentThreeDEditor[1] as string);
    if (!projectId) return { kind: 'my-projects' };
    return {
      kind: 'editor',
      projectId,
      returnTo: { kind: 'my-projects' },
    };
  }
  const independentChessPage =
    /^\/chess\/([^/]+)(?:\/(?:home|play(?:\/(?:game|analysis|versions))?|online|puzzles|learning|bots|review))?$/.exec(
      path ?? '',
    );
  if (independentChessPage) {
    const projectId = decodeRouteParameter(independentChessPage[1] as string);
    if (!projectId) return { kind: 'my-projects' };
    return {
      kind: 'editor',
      projectId,
      returnTo: { kind: 'my-projects' },
    };
  }
  const personalEditor = /^\/(home|projects)\/([^/]+)$/.exec(path ?? '');
  if (personalEditor) {
    return {
      kind: 'editor',
      projectId: personalEditor[2] as string,
      returnTo: personalEditor[1] === 'home' ? { kind: 'home' } : { kind: 'my-projects' },
    };
  }
  return PORTAL_ROUTES.find((route) => route.path === path)?.view ?? { kind: 'home' };
}

export function recentProjects(projects: readonly Project[], limit = 4): readonly Project[] {
  return [...projects]
    .sort((left, right) => {
      const timeDifference =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      return timeDifference === 0 ? left.title.localeCompare(right.title, 'ru') : timeDifference;
    })
    .slice(0, limit);
}

export function creatorHomeState(
  projects: readonly Project[] | null,
  error: string | null,
): CreatorHomeState {
  if (error) return 'error';
  if (projects === null) return 'loading';
  if (projects.length === 0) return 'empty';
  return 'ready';
}
