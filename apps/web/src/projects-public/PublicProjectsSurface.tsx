import type { CreatorPortalView, PublicProjectView } from '../creator-portal/navigation';
import { PublicProjectsPage } from './PublicProjectsPage';
import { PublicProjectPage, PublicationUnavailable } from './PublicProjectPage';

/** The same public routes render for an Account, a StudentSeat and a guest. */
export function PublicProjectsSurface({
  view,
  onNavigate,
  onMyProjects,
}: {
  readonly view: PublicProjectView;
  readonly onNavigate: (view: CreatorPortalView) => void;
  readonly onMyProjects?: () => void;
}): JSX.Element {
  const back = () => onNavigate({ kind: 'public-projects' });
  if (view.kind === 'gallery-work') return <PublicationUnavailable legacy onBack={back} />;
  if (view.kind === 'public-project')
    return (
      <PublicProjectPage
        key={view.publicationId}
        publicationId={view.publicationId}
        onBack={back}
      />
    );
  return (
    <PublicProjectsPage
      view={view}
      onView={onNavigate}
      onOpen={(publicationId) => onNavigate({ kind: 'public-project', publicationId })}
      {...(onMyProjects ? { onMyProjects } : {})}
    />
  );
}
