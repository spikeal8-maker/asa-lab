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
  | { kind: 'classroom'; classroomId: string; classroomTitle: string }
  | { kind: 'teacher-invite'; token: string }
  | { kind: 'help' }
  | { kind: 'account' }
  | { kind: 'classroom-projects'; classroomId: string; classroomTitle: string }
  | {
      kind: 'editor';
      projectId: string;
      moduleKey?: string;
      returnTo:
        | { kind: 'home' }
        | { kind: 'my-projects' }
        | { kind: 'classroom-projects'; classroomId: string; classroomTitle: string };
    };

export type CreatorPortalReturnView = Extract<CreatorPortalView, { kind: 'editor' }>['returnTo'];

export interface PortalNavigationItem {
  readonly section: Exclude<CreatorPortalSection, 'account'>;
  readonly label: string;
}

export type CreatorHomeState = 'loading' | 'error' | 'empty' | 'ready';

const PORTAL_ROUTES: ReadonlyArray<{
  readonly path: string;
  readonly view: Exclude<
    CreatorPortalView,
    | { kind: 'editor' }
    | { kind: 'classroom' }
    | { kind: 'classroom-projects' }
    | { kind: 'teacher-invite' }
  >;
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
  _activeWorkspaceKind: string,
): boolean {
  void _activeWorkspaceKind;
  return navigation.classes;
}

export function sectionForView(view: CreatorPortalView, canTeach: boolean): CreatorPortalSection {
  void canTeach;
  if (view.kind === 'account') return 'account';
  if (view.kind === 'home') return 'home';
  if (view.kind === 'learning') return 'learning';
  if (view.kind === 'collections') return 'collections';
  if (view.kind === 'challenges') return 'challenges';
  if (view.kind === 'help') return 'help';
  if (
    view.kind === 'classrooms' ||
    view.kind === 'classroom' ||
    view.kind === 'classroom-projects' ||
    view.kind === 'teacher-invite'
  ) {
    return 'classes';
  }
  return 'projects';
}

export function creatorViewToHash(view: CreatorPortalView): string {
  const simpleRoute = PORTAL_ROUTES.find((route) => route.view.kind === view.kind);
  if (simpleRoute) return `#${simpleRoute.path}`;
  if (view.kind === 'classroom') {
    return `#/classrooms/${view.classroomId}?title=${encodeURIComponent(view.classroomTitle)}`;
  }
  if (view.kind === 'classroom-projects') {
    return `#/classrooms/${view.classroomId}/projects?title=${encodeURIComponent(view.classroomTitle)}`;
  }
  if (view.kind === 'teacher-invite') {
    return `#/teacher-invite/${encodeURIComponent(view.token)}`;
  }
  if (view.kind !== 'editor') return '#/home';
  if (view.returnTo.kind === 'classroom-projects') {
    return `#/classrooms/${view.returnTo.classroomId}/projects/${view.projectId}?title=${encodeURIComponent(view.returnTo.classroomTitle)}`;
  }
  const returnPath = view.returnTo.kind === 'home' ? 'home' : 'projects';
  return `#/${returnPath}/${view.projectId}`;
}

/**
 * Browser-native destination for a Portal view. Electronics is the first
 * subject editor with a canonical path URL; other modules retain their stable
 * hash routes until their own migration is completed.
 */
export function creatorViewToHref(view: CreatorPortalView): string {
  if (view.kind === 'editor' && view.moduleKey === 'electronics') {
    return `/projects/${encodeURIComponent(view.projectId)}/electronics/edit?returnTo=${encodeURIComponent(
      creatorViewToHash(view.returnTo),
    )}`;
  }
  return `/${creatorViewToHash(view)}`;
}

/** A 3D project is a standalone editor page. Like Tinkercad's editor URLs, the
 * document identity stays canonical while the dashboard return destination is
 * carried separately and survives a refresh. */
export function threeDEditorHash(projectId: string, returnTo: CreatorPortalReturnView): string {
  const returnHash = creatorViewToHash(returnTo);
  return `#/3d/${encodeURIComponent(projectId)}?returnTo=${encodeURIComponent(returnHash.slice(1))}`;
}

function threeDReturnView(query: string | undefined): CreatorPortalReturnView {
  const returnTo = new URLSearchParams(query ?? '').get('returnTo');
  if (returnTo === '/home') return { kind: 'home' };
  if (returnTo === '/projects') return { kind: 'my-projects' };
  const [path, nestedQuery] = (returnTo ?? '').split('?');
  const classroom = /^\/classrooms\/([^/]+)\/projects$/.exec(path ?? '');
  if (classroom) {
    const classroomId = decodeRouteParameter(classroom[1] as string);
    if (classroomId) {
      return {
        kind: 'classroom-projects',
        classroomId,
        classroomTitle: new URLSearchParams(nestedQuery ?? '').get('title') ?? 'Класс',
      };
    }
  }
  return { kind: 'my-projects' };
}

function electronicsReturnView(search: string): CreatorPortalReturnView {
  const requested = new URLSearchParams(search).get('returnTo') ?? '#/projects';
  const parsed = creatorViewFromHash(requested.replace(/^\//, ''));
  if (
    parsed.kind === 'home' ||
    parsed.kind === 'my-projects' ||
    parsed.kind === 'classroom-projects'
  ) {
    return parsed;
  }
  return { kind: 'my-projects' };
}

export function creatorViewFromHash(hash: string): CreatorPortalView {
  const raw = hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  const title = new URLSearchParams(query ?? '').get('title') ?? 'Класс';
  const teacherInvite = /^\/teacher-invite\/([^/]+)$/.exec(path ?? '');
  if (teacherInvite) {
    const token = decodeRouteParameter(teacherInvite[1] as string);
    return token ? { kind: 'teacher-invite', token } : { kind: 'home' };
  }
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
  const classWorkspace = /^\/classrooms\/([^/]+)$/.exec(path ?? '');
  if (classWorkspace) {
    return {
      kind: 'classroom',
      classroomId: classWorkspace[1] as string,
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
      returnTo: threeDReturnView(query),
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

/** Restore a subject editor from a real browser path or a historical hash. */
export function creatorViewFromLocation(location: {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}): CreatorPortalView {
  const electronicsEditor = /^\/projects\/([^/]+)\/electronics\/edit\/?$/.exec(location.pathname);
  if (electronicsEditor) {
    const projectId = decodeRouteParameter(electronicsEditor[1] as string);
    if (!projectId) return { kind: 'my-projects' };
    return {
      kind: 'editor',
      projectId,
      moduleKey: 'electronics',
      returnTo: electronicsReturnView(location.search),
    };
  }
  return creatorViewFromHash(location.hash);
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
