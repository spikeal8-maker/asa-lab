import { PublicationUnavailable } from '../projects-public/PublicProjectPage';

/** Historical Gallery IDs cannot identify a new publication or a private editor. */
export function GalleryWorkPage({ onBack }: { readonly onBack: () => void }): JSX.Element {
  return <PublicationUnavailable legacy onBack={onBack} />;
}
