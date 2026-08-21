export type PublicView =
  | { kind: 'entry' }
  | { kind: 'sign-in' }
  | { kind: 'sign-up' }
  | { kind: 'join-class' }
  | { kind: 'organization-sign-in' };

const PUBLIC_ROUTES: ReadonlyArray<{
  readonly path: string;
  readonly view: Exclude<PublicView, { kind: 'entry' }>;
}> = [
  { path: '/sign-in', view: { kind: 'sign-in' } },
  { path: '/sign-up', view: { kind: 'sign-up' } },
  { path: '/join-class', view: { kind: 'join-class' } },
  { path: '/organization-sign-in', view: { kind: 'organization-sign-in' } },
];

function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/** A normal browser URL for public pages; no client-only `#/...` fragment. */
export function publicViewToHref(view: PublicView): string {
  if (view.kind === 'entry') return '/';
  return PUBLIC_ROUTES.find((route) => route.view.kind === view.kind)?.path ?? '/';
}

/**
 * Resolve clean public paths first and keep old hash links working as a
 * compatibility path. URL fragments never reach the server, which is why the
 * old addresses looked unusual and could not participate in server routing.
 */
export function publicViewFromLocation(location: {
  readonly pathname: string;
  readonly hash: string;
}): PublicView {
  const pathname = withoutTrailingSlash(location.pathname);
  const cleanRoute = PUBLIC_ROUTES.find((route) => route.path === pathname);
  if (cleanRoute) return cleanRoute.view;

  const legacyPath = withoutTrailingSlash(
    (location.hash.replace(/^#/, '').split('?')[0] ?? '').trim(),
  );
  return PUBLIC_ROUTES.find((route) => route.path === legacyPath)?.view ?? { kind: 'entry' };
}
